'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { useWiki, type WikiFile } from './Shell'

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface Node {
  /** Display label: frontmatter title, or a prettified filename. */
  title: string
  /** Directory path (for dirs) or file path (for pages). */
  path: string
  isDir: boolean
  /** For a directory that also has a same-named page (Confluence-style parent page). */
  pagePath?: string
  children: Node[]
}

function pretty(name: string): string {
  return name.replace(/\.md$/, '').replace(/[-_]/g, ' ')
}

function buildTree(files: WikiFile[]): Node[] {
  const root: Node = { title: '', path: '', isDir: true, children: [] }
  const dirs = new Map<string, Node>([['', root]])

  function ensureDir(dirPath: string): Node {
    const existing = dirs.get(dirPath)
    if (existing) return existing
    const parentPath = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : ''
    const parent = ensureDir(parentPath)
    const node: Node = {
      title: pretty(dirPath.split('/').pop() || dirPath),
      path: dirPath,
      isDir: true,
      children: [],
    }
    parent.children.push(node)
    dirs.set(dirPath, node)
    return node
  }

  for (const file of files) {
    if (file.hidden) continue
    const base = file.path.split('/').pop() || file.path
    // Reserved OKF files and repo README stay out of the nav.
    if (base === 'index.md' || base === 'log.md' || base === 'README.md') continue
    const parentPath = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
    const parent = ensureDir(parentPath)
    parent.children.push({
      title: file.title || pretty(base),
      path: file.path,
      isDir: false,
      children: [],
    })
  }

  // Confluence-style merge: a page next to a same-named directory becomes the
  // directory's own page (one expandable node instead of two rows).
  function merge(node: Node) {
    const dirChildren = node.children.filter((c) => c.isDir)
    for (const dir of dirChildren) {
      const twin = node.children.find((c) => !c.isDir && c.path === `${dir.path}.md`)
      if (twin) {
        dir.pagePath = twin.path
        dir.title = twin.title
        node.children = node.children.filter((c) => c !== twin)
      }
      merge(dir)
    }
    node.children.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  }
  merge(root)
  return root.children
}

function TreeLevel({
  nodes,
  activePath,
  expanded,
  toggle,
}: {
  nodes: Node[]
  activePath: string
  expanded: Set<string>
  toggle: (path: string) => void
}) {
  return (
    <div>
      {nodes.map((node) => {
        const linkTarget = node.isDir && node.pagePath ? node.pagePath : node.path
        const isActive = activePath === linkTarget || (node.isDir && activePath === node.path)
        if (node.isDir) {
          const isExpanded = expanded.has(node.path)
          return (
            <div key={node.path}>
              <div className={`tree-row${isActive ? ' active' : ''}`}>
                <button
                  className={`tree-toggle${isExpanded ? ' open' : ''}`}
                  onClick={() => toggle(node.path)}
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  aria-expanded={isExpanded}
                >
                  <Chevron />
                </button>
                <Link href={`/${linkTarget}`} className="tree-link" title={node.path}>
                  {node.title}
                </Link>
              </div>
              {isExpanded && (
                <div className="tree-children">
                  <TreeLevel nodes={node.children} activePath={activePath} expanded={expanded} toggle={toggle} />
                </div>
              )}
            </div>
          )
        }
        return (
          <div key={node.path} className={`tree-row${isActive ? ' active' : ''}`}>
            <span className="tree-toggle leaf">
              <span className="tree-dot" />
            </span>
            <Link href={`/${node.path}`} className="tree-link" title={node.path}>
              {node.title}
            </Link>
          </div>
        )
      })}
    </div>
  )
}

export default function Sidebar() {
  const { files, treeError, settings } = useWiki()
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const activePath = decodeURIComponent(pathname.replace(/^\/(wiki\/|edit\/)?/, ''))

  const tree = useMemo(() => (files ? buildTree(files) : []), [files])

  // Keep the branch to the current page open (Confluence behavior); everything
  // else stays collapsed until the user expands it.
  useEffect(() => {
    if (!activePath) return
    setExpanded((prev) => {
      const next = new Set(prev)
      const segments = activePath.split('/')
      let prefix = ''
      for (let i = 0; i < segments.length - 1; i++) {
        prefix = prefix ? `${prefix}/${segments[i]}` : segments[i]
        next.add(prefix)
      }
      if (activePath.endsWith('.md')) next.add(activePath.slice(0, -3)) // merged parent page
      else next.add(activePath) // directory view
      return next
    })
  }, [activePath])

  const filtered = useMemo(() => {
    if (!files || !query.trim()) return null
    const q = query.toLowerCase()
    return files
      .filter((f) => !f.hidden && !f.path.endsWith('README.md'))
      .filter((f) => f.path.toLowerCase().includes(q) || (f.title || '').toLowerCase().includes(q))
      .slice(0, 100)
  }, [files, query])

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <nav className="sidebar">
      <input
        className="search-box"
        placeholder="Filter pages…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {treeError && <div className="tree-empty">Error: {treeError}</div>}
      {!treeError && files === null && <div className="tree-empty">Loading pages…</div>}
      {!filtered && files !== null && (
        <div className={`tree-row home${activePath === '' ? ' active' : ''}`}>
          <Link href="/" className="tree-link">
            {settings?.name || 'Home'}
          </Link>
        </div>
      )}
      {filtered ? (
        <div>
          {filtered.map((f) => (
            <div key={f.path} className={`tree-row${activePath === f.path ? ' active' : ''}`}>
              <span className="tree-toggle leaf">
                <span className="tree-dot" />
              </span>
              <Link href={`/${f.path}`} className="tree-link" title={f.path}>
                {f.title || pretty(f.path)}
              </Link>
            </div>
          ))}
          {filtered.length === 0 && <div className="tree-empty">No matches.</div>}
        </div>
      ) : (
        <TreeLevel nodes={tree} activePath={activePath} expanded={expanded} toggle={toggle} />
      )}
      <div className="sidebar-spacer" />
      <div className="sidebar-bottom">
        <div className={`tree-row home${activePath === 'graph' ? ' active' : ''}`}>
          <Link href="/graph" className="tree-link">
            Knowledge graph
          </Link>
        </div>
      </div>
    </nav>
  )
}
