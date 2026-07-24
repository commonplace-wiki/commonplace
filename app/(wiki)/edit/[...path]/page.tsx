'use client'

import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState } from 'react'
import MarkdownEditor from '@/components/MarkdownEditor'
import { useWiki } from '@/components/Shell'
import { mergeBodies, mergeFrontmatter } from '@/lib/merge'
import { invalidateCachedPage } from '@/lib/pageCache'

const OKF_KEYS = ['type', 'title', 'description', 'resource', 'tags', 'timestamp']

/**
 * Unsaved edits, mirrored to localStorage so they survive reloads, expired
 * sessions, and save conflicts. `baseBody`/`baseFm` snapshot the page as it
 * was when editing started (the version `sha` points at), which is the base
 * for three-way merging when someone else saved in the meantime.
 */
interface Draft {
  sha?: string
  baseBody: string
  baseFm: Record<string, unknown>
  body: string
  fm: Record<string, unknown>
  tagsText: string
  extraRows: { key: string; value: string }[]
  savedAt: string
}

/** Virtual path segment for title-driven page creation. */
const NEW_PAGE_SEGMENT = '__new__'

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] || c)
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[_.-]+|[_.-]+$/g, '')
}

/** Like slugify, but for directory segments: the case is kept. */
function slugifyDirSegment(value: string): string {
  return value
    .replace(/[äöüßÄÖÜ]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue' })[c] || c)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[_.-]+|[_.-]+$/g, '')
}

/** Normalize a typed directory path: sanitize each segment, keeping case. */
function normalizeDir(value: string): string {
  return value
    .trim()
    .split('/')
    .map((segment) => slugifyDirSegment(segment))
    .filter(Boolean)
    .join('/')
}

type Panel = 'details' | 'publish' | 'more' | 'location' | 'rename' | null

interface ExtraRow {
  id: number
  key: string
  value: string
}

function displayValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Parse an edited value back: numbers, booleans, and JSON stay typed. */
function smartParse(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return text
  }
}

function Editor() {
  const params = useParams<{ path: string[] }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { refreshTree, files, settings } = useWiki()

  const path = (params.path || []).map((s) => decodeURIComponent(s)).join('/')
  // Title-driven creation: /edit/__new__?dir=... has no filename yet; it is
  // derived from the title on first save.
  const isVirtualNew = path === NEW_PAGE_SEGMENT
  const newDir = (searchParams.get('dir') || '').replace(/^\/+|\/+$/g, '')
  const baseName = isVirtualNew ? '' : path.split('/').pop() || ''
  const isReserved = baseName === 'index.md' || baseName === 'log.md'

  const [loaded, setLoaded] = useState(false)
  const [isNew, setIsNew] = useState(false)
  const [sha, setSha] = useState<string | undefined>(undefined)
  const [body, setBody] = useState('')
  const [fm, setFm] = useState<Record<string, unknown>>({})
  const [tagsText, setTagsText] = useState('')
  const [message, setMessage] = useState('')
  const [updateLog, setUpdateLog] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflictPath, setConflictPath] = useState<string | null>(null)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [panel, setPanel] = useState<Panel>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveDir, setMoveDir] = useState(dirOf(path))
  const [moveName, setMoveName] = useState(baseName)
  const [moving, setMoving] = useState(false)
  const [extraRows, setExtraRows] = useState<ExtraRow[]>([])
  const [originalTitle, setOriginalTitle] = useState('')
  const [targetDir, setTargetDir] = useState(newDir)
  const [dirFilter, setDirFilter] = useState('')
  const rowId = useRef(0)
  const actionsRef = useRef<HTMLDivElement>(null)
  const locationRef = useRef<HTMLSpanElement>(null)
  // The page as it was when editing started: the merge base for conflicting
  // saves and the reference for deciding whether a draft is worth keeping.
  const baseRef = useRef<{ body: string; fm: Record<string, unknown> }>({ body: '', fm: {} })
  // The latest version fetched from the server, for "discard draft".
  const serverRef = useRef<{ sha?: string; body: string; fm: Record<string, unknown> } | null>(null)

  const draftKey = `commonplace:draft:${isVirtualNew ? `${NEW_PAGE_SEGMENT}?dir=${newDir}` : path}`

  function clearStoredDraft() {
    try {
      localStorage.removeItem(draftKey)
    } catch {
      // Storage unavailable (private mode, quota): drafts are best effort.
    }
  }

  /** Apply a stored draft to the editor state; false when none exists. */
  function restoreDraft(): boolean {
    let draft: Draft
    try {
      const raw = localStorage.getItem(draftKey)
      if (!raw) return false
      draft = JSON.parse(raw)
    } catch {
      return false
    }
    if (typeof draft?.body !== 'string') return false
    setSha(draft.sha)
    setBody(draft.body)
    setFm(draft.fm && typeof draft.fm === 'object' ? draft.fm : {})
    setTagsText(typeof draft.tagsText === 'string' ? draft.tagsText : '')
    setExtraRows(
      (Array.isArray(draft.extraRows) ? draft.extraRows : []).map((r) => ({
        id: rowId.current++,
        key: String(r.key ?? ''),
        value: String(r.value ?? ''),
      }))
    )
    baseRef.current = {
      body: typeof draft.baseBody === 'string' ? draft.baseBody : '',
      fm: draft.baseFm && typeof draft.baseFm === 'object' ? draft.baseFm : {},
    }
    setDraftSavedAt(draft.savedAt || null)
    return true
  }

  /** Drop the draft and reset the editor to the last version from the server. */
  function discardDraft() {
    clearStoredDraft()
    setDraftSavedAt(null)
    setError(null)
    setConflictPath(null)
    const server = serverRef.current
    if (server) {
      setSha(server.sha)
      setBody(server.body)
      setFm(server.fm)
      setTagsText(Array.isArray(server.fm.tags) ? server.fm.tags.join(', ') : '')
      setExtraRows(
        Object.entries(server.fm)
          .filter(([k]) => !OKF_KEYS.includes(k))
          .map(([k, v]) => ({ id: rowId.current++, key: k, value: displayValue(v) }))
      )
      baseRef.current = { body: server.body, fm: server.fm }
    } else {
      setSha(undefined)
      setBody('')
      setFm({ type: settings?.default_type || '', title: '', description: '', resource: '' })
      setTagsText('')
      setExtraRows([])
      baseRef.current = { body: '', fm: {} }
    }
    // The markdown editor only reads `value` on mount; remount to show the reset.
    setEditorKey((k) => k + 1)
  }

  useEffect(() => {
    setTargetDir(newDir)
  }, [newDir])

  const pageDir = isVirtualNew ? targetDir : dirOf(path)

  function addExtraRow(key = '', value = '') {
    setExtraRows((rows) => [...rows, { id: rowId.current++, key, value }])
  }

  const cancelHref = isNew || isVirtualNew ? `/${pageDir}` : `/${path}`

  // Repo-stored settings drive the defaults for new pages and log recording.
  useEffect(() => {
    if (!settings) return
    setUpdateLog(settings.update_log)
    setFm((prev) => {
      if (typeof prev.type === 'string' && prev.type) return prev
      return { ...prev, type: settings.default_type }
    })
  }, [settings])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (isVirtualNew) {
        setIsNew(true)
        if (!restoreDraft()) setFm({ type: '', title: '', description: '', resource: '' })
        setLoaded(true)
        return
      }
      if (searchParams.get('new') === '1') {
        setIsNew(true)
        if (!restoreDraft()) {
          setFm({
            type: searchParams.get('type') || '',
            title: searchParams.get('title') || '',
            description: '',
            resource: '',
          })
        }
        setLoaded(true)
        return
      }
      const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`)
      if (cancelled) return
      if (res.status === 404) {
        setIsNew(true)
        if (!restoreDraft()) setFm({ type: '', title: '', description: '', resource: '' })
        setLoaded(true)
        return
      }
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to load page')
        setLoaded(true)
        return
      }
      const frontmatter = data.frontmatter || {}
      serverRef.current = { sha: data.sha, body: data.body, fm: frontmatter }
      setOriginalTitle(typeof frontmatter.title === 'string' ? frontmatter.title : '')
      if (!restoreDraft()) {
        setSha(data.sha)
        setBody(data.body)
        setFm(frontmatter)
        setTagsText(Array.isArray(frontmatter.tags) ? frontmatter.tags.join(', ') : '')
        setExtraRows(
          Object.entries(frontmatter)
            .filter(([k]) => !OKF_KEYS.includes(k))
            .map(([k, v]) => ({ id: rowId.current++, key: k, value: displayValue(v) }))
        )
        baseRef.current = { body: data.body, fm: frontmatter }
      }
      setLoaded(true)
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, searchParams, isVirtualNew])

  // Mirror unsaved edits to localStorage (debounced). The draft disappears
  // again as soon as the editor matches the version it was loaded from.
  useEffect(() => {
    if (!loaded) return
    const timer = setTimeout(() => {
      const base = baseRef.current
      const untouchedNew =
        (isNew || isVirtualNew) && !body.trim() && !(typeof fm.title === 'string' && fm.title.trim())
      const baseTags = Array.isArray(base.fm.tags) ? base.fm.tags.join(', ') : ''
      const baseExtras = Object.entries(base.fm)
        .filter(([k]) => !OKF_KEYS.includes(k))
        .map(([k, v]) => [k, displayValue(v)])
      const dirty =
        body !== base.body ||
        tagsText !== baseTags ||
        JSON.stringify(extraRows.map((r) => [r.key, r.value])) !== JSON.stringify(baseExtras) ||
        ['type', 'title', 'description', 'resource'].some((k) => (fm[k] ?? '') !== (base.fm[k] ?? ''))
      try {
        if (untouchedNew || !dirty) {
          localStorage.removeItem(draftKey)
        } else {
          const draft: Draft = {
            sha,
            baseBody: base.body,
            baseFm: base.fm,
            body,
            fm,
            tagsText,
            extraRows: extraRows.map((r) => ({ key: r.key, value: r.value })),
            savedAt: new Date().toISOString(),
          }
          localStorage.setItem(draftKey, JSON.stringify(draft))
        }
      } catch {
        // Storage unavailable: drafts are best effort.
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [loaded, body, fm, tagsText, extraRows, sha, isNew, isVirtualNew, draftKey])

  function field(key: string): string {
    const value = fm[key]
    return typeof value === 'string' ? value : ''
  }

  function setField(key: string, value: string) {
    setFm((prev) => ({ ...prev, [key]: value }))
  }

  /** New filename when a changed title no longer matches the file, else null. */
  function pendingRename(): string | null {
    if (isNew || isVirtualNew || isReserved || !sha) return null
    const title = typeof fm.title === 'string' ? fm.title.trim() : ''
    if (!title || title === originalTitle.trim()) return null
    const slug = slugify(title)
    if (!slug || `${slug}.md` === baseName) return null
    return `${slug}.md`
  }

  async function save(opts: { rename?: boolean; overwrite?: boolean } = {}) {
    // A changed title raises the question whether the file should follow.
    const renameTo = pendingRename()
    if (renameTo && opts.rename === undefined && !opts.overwrite) {
      setPanel('rename')
      return
    }
    // Derive the filename from the title on first save of a new page.
    let targetPath = path
    if (isVirtualNew) {
      const title = typeof fm.title === 'string' ? fm.title.trim() : ''
      const slug = slugify(title)
      if (!slug) {
        setError('Add a title first — the filename is derived from it.')
        return
      }
      let name = slug
      let counter = 2
      const taken = new Set((files || []).map((f) => f.path))
      while (taken.has(targetDir ? `${targetDir}/${name}.md` : `${name}.md`)) {
        name = `${slug}-${counter++}`
      }
      targetPath = targetDir ? `${targetDir}/${name}.md` : `${name}.md`
    }
    setSaving(true)
    setError(null)
    setConflictPath(null)
    setPanel(null)
    const tags = tagsText
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    // Custom fields come exclusively from the editable rows, so removed
    // rows actually disappear from the frontmatter.
    const extrasObj: Record<string, unknown> = {}
    for (const row of extraRows) {
      const key = row.key.trim()
      if (!key || OKF_KEYS.includes(key)) continue
      extrasObj[key] = smartParse(row.value)
    }
    const frontmatter = isReserved
      ? null
      : {
          // Never save without a type: OKF requires it, and the settings
          // default can lose a race against page initialization.
          type:
            typeof fm.type === 'string' && fm.type.trim()
              ? fm.type.trim()
              : settings?.default_type || 'Wiki Page',
          title: fm.title,
          description: fm.description,
          resource: fm.resource,
          ...extrasObj,
          tags,
        }
    const putPage = (putBody: string, putFrontmatter: Record<string, unknown> | null, putSha?: string) =>
      fetch('/api/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath, body: putBody, frontmatter: putFrontmatter, sha: putSha, message, updateLog }),
      })
    const fetchLatest = async () => {
      const latestRes = await fetch(`/api/file?path=${encodeURIComponent(targetPath)}`)
      const latest = await latestRes.json().catch(() => ({}))
      return latestRes.ok ? latest : null
    }

    let saveSha = sha
    if (opts.overwrite) {
      // Deliberate "keep mine" after a conflict: save on top of the latest version.
      const latest = await fetchLatest()
      if (latest && typeof latest.sha === 'string') saveSha = latest.sha
    }
    let res = await putPage(body, frontmatter, saveSha)
    let data = await res.json().catch(() => ({}))
    if (res.status === 409 && !opts.overwrite) {
      // The page changed since it was loaded. When their edits and ours touch
      // different lines (and different frontmatter keys), merge the two and
      // retry against the new sha; overlapping edits stay a conflict.
      const latest = await fetchLatest()
      if (latest && typeof latest.body === 'string') {
        const mergedBody = mergeBodies(baseRef.current.body, body, latest.body)
        const mergedFm =
          frontmatter === null ? null : mergeFrontmatter(baseRef.current.fm, frontmatter, latest.frontmatter || {})
        if (mergedBody !== null && (frontmatter === null || mergedFm !== null)) {
          res = await putPage(mergedBody, mergedFm, latest.sha)
          data = await res.json().catch(() => ({}))
        }
      }
    }
    if (!res.ok) {
      setSaving(false)
      if (res.status === 409) {
        setConflictPath(targetPath)
        setError(
          'Someone else changed this page while you were editing, and their changes overlap with yours. Your text is kept as a local draft.'
        )
      } else {
        setError(data.error || 'Save failed')
      }
      return
    }
    clearStoredDraft()
    // The cached copy is now stale, and the save response does not carry
    // enough (footer commit, provider URLs) to prime a correct replacement.
    invalidateCachedPage(targetPath)
    if (opts.rename && renameTo) {
      const moveRes = await fetch('/api/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: targetPath,
          toDir: dirOf(targetPath),
          newName: renameTo,
          title: typeof fm.title === 'string' ? fm.title : targetPath,
          updateLog,
        }),
      })
      const moveData = await moveRes.json().catch(() => ({}))
      setSaving(false)
      refreshTree()
      if (moveRes.ok) {
        invalidateCachedPage(moveData.path)
        router.push(`/${moveData.path}`)
      } else {
        setError(`Saved, but renaming failed: ${moveData.error || 'unknown error'}`)
      }
      return
    }
    setSaving(false)
    refreshTree()
    router.push(`/${targetPath}`)
  }

  async function remove() {
    if (!sha) return
    if (!window.confirm(`Delete ${path}? This commits a deletion to the repository.`)) return
    setPanel(null)
    setDeleting(true)
    setError(null)
    const title = typeof fm.title === 'string' && fm.title ? fm.title : path
    const res = await fetch('/api/file', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, sha, title }),
    })
    setDeleting(false)
    if (res.ok) {
      clearStoredDraft()
      invalidateCachedPage(path)
      refreshTree()
      router.push(`/${dirOf(path)}`)
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Delete failed')
    }
  }

  const subtree = path.slice(0, -3)
  const targetDirs = Array.from(
    new Set(
      (files || []).flatMap((f) => {
        const dirs: string[] = []
        const segments = f.path.split('/')
        for (let i = 1; i < segments.length; i++) {
          dirs.push(segments.slice(0, i).join('/'))
        }
        return dirs
      })
    )
  )
    .filter((d) => d !== subtree && !d.startsWith(`${subtree}/`))
    .sort()

  async function move(e: React.FormEvent) {
    e.preventDefault()
    setMoving(true)
    setError(null)
    const res = await fetch('/api/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        toDir: normalizeDir(moveDir),
        newName: moveName,
        title: typeof fm.title === 'string' && fm.title ? fm.title : path,
        updateLog,
      }),
    })
    const data = await res.json().catch(() => ({}))
    setMoving(false)
    if (res.ok) {
      // Moving discards unsaved edits (the form says so), including the draft.
      clearStoredDraft()
      // Both ends of the move: the source is gone, the target is new.
      invalidateCachedPage(path)
      invalidateCachedPage(data.path)
      refreshTree()
      router.push(`/${data.path}`)
    } else {
      setError(data.error || 'Move failed')
    }
  }

  // Close popovers on outside click.
  useEffect(() => {
    if (!panel) return
    function onClick(e: MouseEvent) {
      const target = e.target as Node
      if (actionsRef.current?.contains(target)) return
      if (locationRef.current?.contains(target)) return
      setPanel(null)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [panel])

  // Keyboard: Cmd/Ctrl+Enter publishes, Esc closes popovers, then the editor.
  const saveRef = useRef(save)
  saveRef.current = save
  const discardRef = useRef(clearStoredDraft)
  discardRef.current = clearStoredDraft
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        saveRef.current()
      } else if (e.key === 'Escape' && !e.defaultPrevented) {
        setPanel((current) => {
          if (current) return null
          setMoveOpen((open) => {
            if (!open) {
              // Closing the editor abandons the edit, draft included.
              discardRef.current()
              router.push(cancelHref)
            }
            return false
          })
          return null
        })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelHref])

  if (!loaded) return <p className="muted">Loading editor…</p>

  // Filename no longer derived from the current title (e.g. after a title
  // edit, or legacy underscore names): offer an inline rename next to the path.
  const titleSlug = !isReserved && typeof fm.title === 'string' ? slugify(fm.title) : ''
  const titleMismatch =
    !isNew && !isVirtualNew && !!sha && !isReserved && !!titleSlug && `${titleSlug}.md` !== baseName

  return (
    <div className="editor-page">
      <div className="editor-bar">
        {isVirtualNew ? (
          <span className="editor-path" ref={locationRef} style={{ position: 'relative', overflow: 'visible' }}>
            New page in{' '}
            <button
              className="location-btn"
              onClick={() => setPanel(panel === 'location' ? null : 'location')}
              title="Change parent directory"
            >
              /{targetDir}
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {panel === 'location' && (
              <span className="editor-popover location-popover">
                <input
                  className="search-box"
                  placeholder="Filter directories…"
                  value={dirFilter}
                  onChange={(e) => setDirFilter(e.target.value)}
                  autoFocus
                />
                <span className="location-list">
                  {['', ...targetDirs]
                    .filter((d) => d.toLowerCase().includes(dirFilter.toLowerCase()))
                    .map((d) => (
                      <button
                        key={d || '/'}
                        className={`user-menu-item${d === targetDir ? ' active-dir' : ''}`}
                        onClick={() => {
                          setTargetDir(d)
                          setPanel(null)
                          setDirFilter('')
                        }}
                      >
                        /{d}
                      </button>
                    ))}
                  {normalizeDir(dirFilter) && !['', ...targetDirs].includes(normalizeDir(dirFilter)) && (
                    <button
                      className="user-menu-item create-dir"
                      onClick={() => {
                        setTargetDir(normalizeDir(dirFilter))
                        setPanel(null)
                        setDirFilter('')
                      }}
                    >
                      + Create directory /{normalizeDir(dirFilter)}
                    </button>
                  )}
                </span>
              </span>
            )}
          </span>
        ) : (
          <span className="editor-path">
            {isNew ? 'New page' : 'Editing'} · {path}
            {titleMismatch && !moveOpen && (
              <button
                className="rename-hint"
                title={`Rename file to ${titleSlug}.md`}
                onClick={() => {
                  setMoveDir(dirOf(path))
                  setMoveName(`${titleSlug}.md`)
                  setMoveOpen(true)
                }}
              >
                Rename to match title
              </button>
            )}
          </span>
        )}
        <div className="topbar-spacer" />
        <div className="editor-actions" ref={actionsRef}>
          <Link className="cancel-link" href={cancelHref} title="Close editor (Esc)" onClick={clearStoredDraft}>
            Cancel
          </Link>
          <button
            className={`btn icon-btn${panel === 'more' || panel === 'details' ? ' active' : ''}`}
            title="More actions"
            onClick={() => setPanel(panel === 'more' ? null : 'more')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <circle cx="3" cy="8" r="1.4" />
              <circle cx="8" cy="8" r="1.4" />
              <circle cx="13" cy="8" r="1.4" />
            </svg>
          </button>
          <div className="publish-split">
            <button className="btn btn-primary" onClick={() => save()} disabled={saving || deleting} title="Save (⌘⏎)">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              className="btn btn-primary publish-caret"
              aria-label="Save options"
              onClick={() => setPanel(panel === 'publish' ? null : 'publish')}
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {panel === 'details' && !isReserved && (
            <div className="editor-popover">
              <div className="field">
                <label>Type * (OKF concept type)</label>
                <input
                  value={field('type')}
                  onChange={(e) => setField('type', e.target.value)}
                  placeholder="e.g. Playbook, BigQuery Table, API Endpoint"
                />
              </div>
              <div className="field">
                <label>Description</label>
                <input
                  value={field('description')}
                  onChange={(e) => setField('description', e.target.value)}
                  placeholder="One-line summary used in previews and indexes"
                />
              </div>
              <div className="field">
                <label>Resource URI</label>
                <input
                  value={field('resource')}
                  onChange={(e) => setField('resource', e.target.value)}
                  placeholder="Canonical URI of the underlying asset (optional)"
                />
              </div>
              <div className="field" style={{ marginBottom: 4 }}>
                <label>Tags (comma-separated)</label>
                <input
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="ops, billing — tag “hidden” hides the page from the nav"
                />
              </div>
              <div className="field" style={{ marginBottom: 0, marginTop: 12 }}>
                <label>Custom fields</label>
                {extraRows.map((row) => (
                  <div className="custom-field-row" key={row.id}>
                    <input
                      value={row.key}
                      placeholder="key"
                      className={OKF_KEYS.includes(row.key.trim()) ? 'invalid' : undefined}
                      onChange={(e) =>
                        setExtraRows((rows) =>
                          rows.map((r) => (r.id === row.id ? { ...r, key: e.target.value } : r))
                        )
                      }
                    />
                    <input
                      value={row.value}
                      placeholder="value"
                      style={{ flex: 1.6 }}
                      onChange={(e) =>
                        setExtraRows((rows) =>
                          rows.map((r) => (r.id === row.id ? { ...r, value: e.target.value } : r))
                        )
                      }
                    />
                    <button
                      type="button"
                      className="row-remove"
                      title="Remove field"
                      onClick={() => setExtraRows((rows) => rows.filter((r) => r.id !== row.id))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" className="btn" style={{ marginTop: 4 }} onClick={() => addExtraRow()}>
                  + Add field
                </button>
                {extraRows.some((r) => OKF_KEYS.includes(r.key.trim())) && (
                  <div className="hint" style={{ color: 'var(--danger)' }}>
                    Keys matching OKF fields ({OKF_KEYS.join(', ')}) are ignored on save.
                  </div>
                )}
              </div>
            </div>
          )}

          {panel === 'more' && (
            <div className="editor-popover menu">
              {!isReserved && (
                <button className="user-menu-item" onClick={() => setPanel('details')}>
                  Page properties
                </button>
              )}
              {!isNew && sha && (
                <button
                  className="user-menu-item"
                  onClick={() => {
                    setPanel(null)
                    setMoveOpen(true)
                  }}
                >
                  Move…
                </button>
              )}
              {!isNew && sha && (
                <>
                  <div className="user-menu-sep" />
                  <button className="user-menu-item danger" onClick={remove} disabled={deleting}>
                    {deleting ? 'Deleting…' : 'Delete page'}
                  </button>
                </>
              )}
            </div>
          )}

          {panel === 'publish' && (
            <div className="editor-popover">
              <div className="field">
                <label>Commit message (optional)</label>
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={`${isNew ? 'Create' : 'Update'} ${path}`}
                  autoFocus
                />
              </div>
              {!isReserved && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={updateLog}
                    onChange={(e) => setUpdateLog(e.target.checked)}
                    style={{ width: 'auto' }}
                  />
                  Record this change in log.md
                </label>
              )}
              <button className="btn btn-primary" onClick={() => save()} disabled={saving} style={{ marginTop: 10 }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}

          {panel === 'rename' && (
            <div className="editor-popover">
              <p style={{ margin: '0 0 6px', fontWeight: 600 }}>You changed the title. Rename the file to match?</p>
              <p className="muted" style={{ margin: '0 0 12px', fontSize: 12.5 }}>
                New filename:{' '}
                <code>
                  /{dirOf(path) ? `${dirOf(path)}/` : ''}
                  {pendingRename()}
                </code>
                <br />
                Links from other pages are rewritten automatically, but the page URL changes.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  disabled={saving}
                  onClick={() => {
                    setPanel(null)
                    save({ rename: true })
                  }}
                >
                  {saving ? 'Saving…' : 'Save & rename'}
                </button>
                <button
                  className="btn"
                  disabled={saving}
                  onClick={() => {
                    setPanel(null)
                    save({ rename: false })
                  }}
                >
                  Save, keep filename
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          {conflictPath && (
            <div className="conflict-actions">
              <a href={`/${conflictPath}`} target="_blank" rel="noreferrer">
                Open the latest version in a new tab
              </a>
              <button className="banner-btn" onClick={() => save({ overwrite: true })} disabled={saving}>
                {saving ? 'Saving…' : 'Save anyway, replacing their changes'}
              </button>
            </div>
          )}
        </div>
      )}
      {draftSavedAt && (
        <div className="notice draft-notice">
          Restored unsaved changes from {new Date(draftSavedAt).toLocaleString()}.{' '}
          <button className="banner-btn" onClick={discardDraft}>
            Discard them and load the saved page
          </button>
        </div>
      )}

      {moveOpen && !isNew && (
        <form className="fm-panel" onSubmit={move}>
          <h3>Move page</h3>
          <div className="fm-grid">
            <div className="field">
              <label>New parent</label>
              <input
                list="move-dir-options"
                value={moveDir}
                onChange={(e) => setMoveDir(e.target.value)}
                placeholder="/ (wiki root)"
              />
              <datalist id="move-dir-options">
                {targetDirs.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
              <div className="hint">Pick an existing directory or type a new path to create it.</div>
            </div>
            <div className="field">
              <label>Filename</label>
              <input value={moveName} onChange={(e) => setMoveName(e.target.value)} />
            </div>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Subpages move along in the same commit, and links from all other pages are rewritten to the
            new location. Unsaved edits are discarded.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" disabled={moving || !moveName.trim()}>
              {moving ? 'Moving…' : `Move to /${moveDir ? `${moveDir}/` : ''}${moveName}`}
            </button>
            <button type="button" className="btn" onClick={() => setMoveOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {isReserved ? (
        baseName !== 'index.md' && (
          <h1 className="page-title" style={{ marginTop: 8 }}>
            {baseName}
          </h1>
        )
      ) : (
        <input
          className="title-input"
          value={field('title')}
          onChange={(e) => setField('title', e.target.value)}
          placeholder="Page title"
          autoFocus={isNew}
        />
      )}

      <MarkdownEditor
        key={editorKey}
        value={body}
        onChange={setBody}
        pageDir={pageDir}
        pages={(files || [])
          .filter((f) => !f.path.endsWith('README.md') && !f.path.endsWith('log.md'))
          .map((f) => ({ path: f.path, title: f.title }))}
        placeholder={
          isReserved
            ? '# Section Heading\n\n* [Concept Title](./concept.md) - short description'
            : 'Write your page here. Link other pages with [title](/path/page.md).'
        }
      />
    </div>
  )
}

export default function EditPage() {
  return (
    <Suspense>
      <Editor />
    </Suspense>
  )
}
