'use client'

import '@mdxeditor/editor/style.css'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  AdmonitionDirectiveDescriptor,
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  DiffSourceToggleWrapper,
  InsertAdmonition,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  ListsToggle,
  MDXEditor,
  Separator,
  StrikeThroughSupSubToggles,
  UndoRedo,
  cancelLinkEdit$,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkDialogState$,
  linkPlugin,
  listsPlugin,
  directivesPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  removeLink$,
  switchFromPreviewToLinkEdit$,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  updateLink$,
  useCellValues,
  usePublisher,
} from '@mdxeditor/editor'

export interface WikiPageRef {
  path: string
  title: string | null
}

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  /** Bundle-relative directory of the page; uploads land in `<pageDir>/assets/`. */
  pageDir: string
  placeholder?: string
  /** All wiki pages, for the Confluence-style link dialog. */
  pages?: WikiPageRef[]
}

const PagesContext = createContext<WikiPageRef[]>([])

function pageLabel(page: WikiPageRef): string {
  return page.title || (page.path.split('/').pop() || page.path).replace(/\.md$/, '').replace(/[-_]/g, ' ')
}

/** True when the query should be treated as a raw link target, not a search. */
function looksLikeUrl(query: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(query) || query.startsWith('/') || query.startsWith('#')
}

/** The insert actions, shared between the inline group and the + menu. */
function InsertActions() {
  return (
    <>
      <CreateLink />
      <InsertImage />
      <InsertTable />
      <InsertCodeBlock />
      <InsertAdmonition />
    </>
  )
}

/**
 * Confluence-style "+" insert menu: on narrow screens the insert buttons
 * collapse into this dropdown (visibility switched via CSS).
 */
function InsertMenu() {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="tb-insert-menu" ref={wrapRef}>
      <button
        type="button"
        className={`tb-plus${open ? ' open' : ''}`}
        title="Insert"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        +
      </button>
      {open && (
        <div className="tb-insert-popover" onClick={() => setOpen(false)}>
          <InsertActions />
        </div>
      )}
    </div>
  )
}

/**
 * Confluence-style link dialog: search wiki pages by title, or paste a URL.
 * Replaces MDXEditor's default URL-only dialog via linkDialogPlugin.
 */
function WikiLinkDialog() {
  const pages = useContext(PagesContext)
  const [state] = useCellValues(linkDialogState$)
  const updateLink = usePublisher(updateLink$)
  const cancelEdit = usePublisher(cancelLinkEdit$)
  const removeLink = usePublisher(removeLink$)
  const switchToEdit = usePublisher(switchFromPreviewToLinkEdit$)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const openedForKey = useRef<string | null>(null)

  useEffect(() => {
    if (state.type === 'edit' && openedForKey.current !== state.linkNodeKey) {
      openedForKey.current = state.linkNodeKey
      setQuery(state.initialUrl || '')
      setActive(0)
    }
    if (state.type === 'inactive') {
      openedForKey.current = null
    }
  }, [state])

  useEffect(() => {
    // cancelLinkEdit$ is only legal in edit mode; the preview popup dismisses
    // itself when the selection leaves the link.
    if (state.type !== 'edit') return
    function onMouseDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) cancelEdit()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [state.type, cancelEdit])

  if (state.type === 'inactive') return <></>

  const rect = state.rectangle
  const style: React.CSSProperties = {
    position: 'fixed',
    top: rect.top + rect.height + 6,
    left: Math.max(8, Math.min(rect.left, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 400)),
  }

  if (state.type === 'preview') {
    const internal = state.url.startsWith('/')
    const page = internal ? pages.find((p) => `/${p.path}` === state.url.split('#')[0]) : undefined
    return (
      <div className="link-dialog link-preview" style={style} ref={wrapRef}>
        <a href={state.url} target="_blank" rel="noreferrer" className="link-preview-target">
          {page ? pageLabel(page) : state.url}
        </a>
        <button className="btn" onClick={() => switchToEdit()}>
          Edit
        </button>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(state.url)}>
          Copy
        </button>
        <button className="btn btn-danger" onClick={() => removeLink()}>
          Remove
        </button>
      </div>
    )
  }

  // edit state
  const trimmed = query.trim()
  const q = trimmed.toLowerCase()
  const results = trimmed && !looksLikeUrl(trimmed)
    ? pages
        .filter((p) => pageLabel(p).toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
        .slice(0, 8)
    : trimmed
      ? pages.filter((p) => `/${p.path}`.toLowerCase().startsWith(q)).slice(0, 8)
      : pages.slice(0, 8)
  const showUrlRow = trimmed.length > 0 && (looksLikeUrl(trimmed) || results.length === 0)

  function choose(page: WikiPageRef) {
    updateLink({
      url: `/${page.path}`,
      title: undefined,
      text: state.type === 'edit' && state.text.trim() ? state.text : pageLabel(page),
    })
  }

  function chooseUrl() {
    updateLink({
      url: trimmed,
      title: undefined,
      text: state.type === 'edit' && state.text.trim() ? state.text : trimmed,
    })
  }

  const optionCount = results.length + (showUrlRow ? 1 : 0)

  return (
    <div className="link-dialog" style={style} ref={wrapRef}>
      <input
        className="search-box"
        autoFocus
        placeholder="Search pages, or paste a link…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            cancelEdit()
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((a) => Math.min(a + 1, optionCount - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((a) => Math.max(a - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (active < results.length && results[active]) choose(results[active])
            else if (showUrlRow) chooseUrl()
          }
        }}
      />
      <div className="location-list">
        {results.map((p, i) => (
          <button
            key={p.path}
            className={`user-menu-item link-result${i === active ? ' active-dir' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault()
              choose(p)
            }}
            onMouseEnter={() => setActive(i)}
          >
            <span className="link-result-title">{pageLabel(p)}</span>
            <span className="link-result-path">/{p.path}</span>
          </button>
        ))}
        {showUrlRow && (
          <button
            className={`user-menu-item link-result${active === results.length ? ' active-dir' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault()
              chooseUrl()
            }}
            onMouseEnter={() => setActive(results.length)}
          >
            <span className="link-result-title">Link to “{trimmed}”</span>
          </button>
        )}
        {!showUrlRow && results.length === 0 && <span className="tree-empty">No matching pages.</span>}
      </div>
    </div>
  )
}

const CODE_LANGUAGES = {
  '': 'Plain text',
  txt: 'Plain text',
  sql: 'SQL',
  js: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  tsx: 'TSX',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  bash: 'Bash',
  sh: 'Shell',
  python: 'Python',
  py: 'Python',
  css: 'CSS',
  html: 'HTML',
  md: 'Markdown',
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

/**
 * MDX cannot parse angle-bracket autolinks (`<https://x>`), and migrated pages
 * sometimes contain a dangling `<` before a URL. Convert both to plain URLs,
 * which GFM autolinks anyway, so the rich editor can open the page.
 */
function sanitizeForEditor(markdown: string): string {
  return markdown.replace(/<(https?:\/\/[^>\s]+)>/g, '$1').replace(/<(?=https?:\/\/)/g, '')
}

/**
 * Resolve an OKF image src to a URL the browser can load while editing.
 * Absolute (bundle-root-relative) and relative paths are served through
 * /api/raw, mirroring the link resolution in Markdown.tsx. The markdown
 * itself keeps the original OKF path.
 */
function previewUrl(src: string, pageDir: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('data:')) return src
  const segments = src.startsWith('/') ? [] : pageDir ? pageDir.split('/') : []
  for (const part of src.replace(/^\/+/, '').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  return `/api/raw?path=${encodeURIComponent(segments.join('/'))}`
}

export default function InitializedMDXEditor({ value, onChange, pageDir, placeholder, pages }: MarkdownEditorProps) {
  // The "diff" view compares against the page as it was loaded, not the live value.
  const initialMarkdown = useRef(sanitizeForEditor(value)).current
  // Pages migrated from Confluence can contain raw angle brackets or HTML that
  // the MDX parser rejects. When that happens, remount straight into source
  // mode so the page stays editable instead of showing only the error banner.
  const [sourceOnly, setSourceOnly] = useState(false)

  async function imageUploadHandler(image: File): Promise<string> {
    const content = await fileToBase64(image)
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: pageDir, name: image.name || 'pasted-image.png', content }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Upload failed')
    return `/${data.path}`
  }

  return (
    <PagesContext.Provider value={pages || []}>
      <div className="md-editor">
        <MDXEditor
          key={sourceOnly ? 'source' : 'rich'}
        markdown={sanitizeForEditor(value)}
        onChange={onChange}
        onError={() => {
          // MDXEditor fires this during its own render; defer the state update
          // so React does not flag a cross-component setState-in-render.
          setTimeout(() => setSourceOnly(true), 0)
        }}
        placeholder={placeholder}
        contentEditableClassName="mdx-body markdown"
        plugins={[
          toolbarPlugin({
            toolbarContents: () => (
              <DiffSourceToggleWrapper>
                <UndoRedo />
                <Separator />
                <BlockTypeSelect />
                <Separator />
                <BoldItalicUnderlineToggles options={['Bold', 'Italic']} />
                <StrikeThroughSupSubToggles options={['Strikethrough']} />
                <CodeToggle />
                <Separator />
                <ListsToggle />
                <Separator />
                <span className="tb-inserts-inline">
                  <InsertActions />
                </span>
                <InsertMenu />
              </DiffSourceToggleWrapper>
            ),
          }),
          headingsPlugin(),
          listsPlugin(),
          quotePlugin(),
          thematicBreakPlugin(),
          linkPlugin(),
          linkDialogPlugin({ LinkDialog: WikiLinkDialog }),
          directivesPlugin({ directiveDescriptors: [AdmonitionDirectiveDescriptor] }),
          imagePlugin({
            imageUploadHandler,
            imagePreviewHandler: (src) => Promise.resolve(previewUrl(src, pageDir)),
          }),
          tablePlugin(),
          codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
          codeMirrorPlugin({ codeBlockLanguages: CODE_LANGUAGES }),
          diffSourcePlugin({ viewMode: sourceOnly ? 'source' : 'rich-text', diffMarkdown: initialMarkdown }),
          markdownShortcutPlugin(),
        ]}
      />
      {sourceOnly && (
        <div className="md-statusbar">
          This page contains markup the rich editor cannot parse, so it opened in markdown source mode.
          Your edits save as usual.
        </div>
      )}
      </div>
    </PagesContext.Provider>
  )
}
