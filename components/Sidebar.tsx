'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
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

type OrderMap = Record<string, string[]>

function pretty(name: string): string {
  return name.replace(/\.md$/, '').replace(/[-_]/g, ' ')
}

/** Node name as used in order.yaml lists: basename without the .md suffix. */
function orderKey(path: string): string {
  return (path.split('/').pop() || path).replace(/\.md$/, '')
}

function buildTree(files: WikiFile[], order: OrderMap): Node[] {
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
    // Children listed in order.yaml come first, in that order; the rest keep
    // the title sort.
    const list = order[node.path] ?? []
    node.children.sort((a, b) => {
      const ia = list.indexOf(orderKey(a.path))
      const ib = list.indexOf(orderKey(b.path))
      if (ia !== -1 && ib !== -1) return ia - ib
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    })
  }
  merge(root)
  return root.children
}

function TreeLevel({
  nodes,
  dir,
  activePath,
  expanded,
  toggle,
  onReorder,
  saving,
}: {
  nodes: Node[]
  /** Directory path of this sibling group ('' for the bundle root). */
  dir: string
  activePath: string
  expanded: Set<string>
  toggle: (path: string) => void
  /** When set, rows are draggable and drops persist the new sibling order. */
  onReorder?: (dir: string, names: string[], moved: string) => void
  /** Row whose reorder commit is still in flight (shows a spinner). */
  saving?: { dir: string; name: string } | null
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  /** Insertion index (0..nodes.length) while dragging over this level. */
  const [dropIdx, setDropIdx] = useState<number | null>(null)

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    if (dragIdx === null || dropIdx === null) return
    const names = nodes.map((n) => orderKey(n.path))
    const [moved] = names.splice(dragIdx, 1)
    names.splice(dropIdx > dragIdx ? dropIdx - 1 : dropIdx, 0, moved)
    setDragIdx(null)
    setDropIdx(null)
    if (names.some((n, i) => n !== orderKey(nodes[i].path))) onReorder?.(dir, names, moved)
  }

  // Drops are only accepted between siblings: rows of other levels never set
  // this level's dragIdx, so their dragover falls through unhandled.
  function dnd(i: number) {
    if (!onReorder) return {}
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent<HTMLDivElement>) => {
        e.stopPropagation()
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', nodes[i].path)
        setDragIdx(i)
      },
      onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
        if (dragIdx === null) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'move'
        const rect = e.currentTarget.getBoundingClientRect()
        setDropIdx(e.clientY < rect.top + rect.height / 2 ? i : i + 1)
      },
      onDrop: handleDrop,
      onDragEnd: () => {
        setDragIdx(null)
        setDropIdx(null)
      },
    }
  }

  function dndClass(i: number): string {
    if (dragIdx === null) return ''
    let cls = ''
    if (i === dragIdx) cls += ' dragging'
    if (dropIdx === i) cls += ' drop-before'
    if (dropIdx === nodes.length && i === nodes.length - 1) cls += ' drop-after'
    return cls
  }

  return (
    <div>
      {nodes.map((node, i) => {
        const linkTarget = node.isDir && node.pagePath ? node.pagePath : node.path
        const isActive = activePath === linkTarget || (node.isDir && activePath === node.path)
        const isSaving = saving != null && saving.dir === dir && saving.name === orderKey(node.path)
        const spinner = isSaving && <span className="tree-spinner" aria-label="Saving order…" />
        if (node.isDir) {
          const isExpanded = expanded.has(node.path)
          return (
            <div key={node.path}>
              <div className={`tree-row${isActive ? ' active' : ''}${dndClass(i)}`} {...dnd(i)}>
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
                {spinner}
              </div>
              {isExpanded && (
                <div className="tree-children">
                  <TreeLevel
                    nodes={node.children}
                    dir={node.path}
                    activePath={activePath}
                    expanded={expanded}
                    toggle={toggle}
                    onReorder={onReorder}
                    saving={saving}
                  />
                </div>
              )}
            </div>
          )
        }
        return (
          <div key={node.path} className={`tree-row${isActive ? ' active' : ''}${dndClass(i)}`} {...dnd(i)}>
            <span className="tree-toggle leaf">
              <span className="tree-dot" />
            </span>
            <Link href={`/${node.path}`} className="tree-link" title={node.path}>
              {node.title}
            </Link>
            {spinner}
          </div>
        )
      })}
    </div>
  )
}

export default function Sidebar() {
  const { files, order, treeError, settings, me, refreshTree } = useWiki()
  const pathname = usePathname()
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Optimistic reorders, merged over the server state so the sidebar keeps
  // the new order while GitHub's read still lags the commit.
  const [orderOverride, setOrderOverride] = useState<OrderMap>({})
  // The just-dropped row while its commit and tree reload are in flight;
  // further drags wait until it clears.
  const [saving, setSaving] = useState<{ dir: string; name: string } | null>(null)
  const [reorderError, setReorderError] = useState<string | null>(null)

  const activePath = decodeURIComponent(pathname.replace(/^\/(wiki\/|edit\/)?/, ''))

  const effectiveOrder = useMemo(() => ({ ...order, ...orderOverride }), [order, orderOverride])
  const tree = useMemo(() => (files ? buildTree(files, effectiveOrder) : []), [files, effectiveOrder])

  const reorder = useCallback(
    (dir: string, names: string[], moved: string) => {
      setReorderError(null)
      setSaving({ dir, name: moved })
      setOrderOverride((prev) => ({ ...prev, [dir]: names }))
      fetch('/api/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir, children: names }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data.error || 'Could not save the new order')
          }
          await refreshTree()
        })
        .catch((err) => {
          setReorderError(err.message)
          setOrderOverride((prev) => {
            const next = { ...prev }
            delete next[dir]
            return next
          })
        })
        .finally(() => setSaving(null))
    },
    [refreshTree]
  )

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
      {reorderError && <div className="tree-empty">Reorder failed: {reorderError}</div>}
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
        <TreeLevel
          nodes={tree}
          dir=""
          activePath={activePath}
          expanded={expanded}
          toggle={toggle}
          onReorder={me && me.canWrite !== false && !saving ? reorder : undefined}
          saving={saving}
        />
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
