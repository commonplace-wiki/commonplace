'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWiki, type WikiFile } from './Shell'
import { buildTree, childrenByDir, orderKey, planMove, pretty, remapMovedFiles, type Node, type OrderMap } from '@/lib/nav'

/**
 * "Loading pages…" only appears when the tree is actually slow to arrive;
 * with the usual fast response it would just flash for a frame or two.
 */
function TreeLoading() {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 200)
    return () => clearTimeout(t)
  }, [])
  return visible ? <div className="tree-empty">Loading pages…</div> : null
}

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TreeLevel({
  nodes,
  dir,
  activePath,
  expanded,
  toggle,
  onReorder,
  saving,
  onMove,
  moving,
  moveDisabled,
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
  /** When set, rows show indent/outdent controls. */
  onMove?: (node: Node, direction: 'in' | 'out') => void
  /** Path of the row whose move commit is in flight. */
  moving?: string | null
  /** True while any move is in flight (all controls disabled). */
  moveDisabled?: boolean
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
        const isMoving = moving != null && moving === node.path
        const moveSpinner = isMoving && <span className="tree-spinner" aria-label="Moving…" />
        const actions = (
          <span className="tree-actions">
            <button
              type="button"
              className="tree-move"
              title="Move out of the folder"
              aria-label="Outdent"
              disabled={!onMove || moveDisabled || dir === ''}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onMove?.(node, 'out')
              }}
            >
              ←
            </button>
            <button
              type="button"
              className="tree-move"
              title="Move into the item above"
              aria-label="Indent"
              disabled={!onMove || moveDisabled || i === 0}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onMove?.(node, 'in')
              }}
            >
              →
            </button>
          </span>
        )
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
                <span className="tree-number" aria-hidden="true">
                  {node.number}
                </span>
                <Link href={`/${linkTarget}`} className="tree-link" title={node.path}>
                  {node.title}
                </Link>
                {spinner}
                {moveSpinner}
                {actions}
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
                    onMove={onMove}
                    moving={moving}
                    moveDisabled={moveDisabled}
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
            <span className="tree-number" aria-hidden="true">
              {node.number}
            </span>
            <Link href={`/${node.path}`} className="tree-link" title={node.path}>
              {node.title}
            </Link>
            {spinner}
            {moveSpinner}
            {actions}
          </div>
        )
      })}
    </div>
  )
}

export default function Sidebar({ open = false }: { open?: boolean }) {
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
  // Optimistic file remap while a move's commit and tree reload are in flight.
  const [filesOverride, setFilesOverride] = useState<WikiFile[] | null>(null)
  // Path of the row being moved (shows a spinner; blocks further moves).
  const [moving, setMoving] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)

  const activePath = decodeURIComponent(pathname.replace(/^\/(wiki\/|edit\/)?/, ''))

  const effectiveOrder = useMemo(() => ({ ...order, ...orderOverride }), [order, orderOverride])
  const effectiveFiles = filesOverride ?? files
  const tree = useMemo(
    () => (effectiveFiles ? buildTree(effectiveFiles, effectiveOrder) : []),
    [effectiveFiles, effectiveOrder]
  )
  const childrenMap = useMemo(() => childrenByDir(tree), [tree])

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

  // Indent (nest under the preceding sibling) or outdent (lift to the parent
  // level, after the former parent) a node, moving its whole subtree.
  const move = useCallback(
    (node: Node, direction: 'in' | 'out') => {
      setMoveError(null)
      const plan = planMove(childrenMap, node, direction)
      if (!plan) return
      const { toDir, children: destChildren } = plan

      // A merged folder/page moves as its page (the API carries the subpages).
      const movePath = node.pagePath ?? node.path
      setMoving(node.path)
      setFilesOverride((prev) => remapMovedFiles(prev ?? files ?? [], node, toDir))
      setOrderOverride((prev) => ({ ...prev, [toDir]: destChildren }))
      // Reveal the destination so the optimistic move is visible.
      setExpanded((prev) => {
        const next = new Set(prev)
        if (toDir) {
          let prefix = ''
          for (const segment of toDir.split('/')) {
            prefix = prefix ? `${prefix}/${segment}` : segment
            next.add(prefix)
          }
        }
        return next
      })

      fetch('/api/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: movePath,
          toDir,
          order: { dir: toDir, children: destChildren },
          title: node.title,
        }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data.error || 'Move failed')
          await refreshTree()
          setFilesOverride(null)
          setOrderOverride((prev) => {
            const next = { ...prev }
            delete next[toDir]
            return next
          })
        })
        .catch((err) => {
          setMoveError(err.message)
          setFilesOverride(null)
          setOrderOverride((prev) => {
            const next = { ...prev }
            delete next[toDir]
            return next
          })
        })
        .finally(() => setMoving(null))
    },
    [childrenMap, files, refreshTree]
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
    <nav id="wiki-sidebar" className={`sidebar${open ? ' open' : ''}`}>
      <input
        className="search-box"
        placeholder="Filter pages…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {treeError && <div className="tree-empty">Error: {treeError}</div>}
      {reorderError && <div className="tree-empty">Reorder failed: {reorderError}</div>}
      {moveError && <div className="tree-empty">Move failed: {moveError}</div>}
      {!treeError && files === null && <TreeLoading />}
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
          onReorder={me && me.canWrite !== false && !saving && !moving ? reorder : undefined}
          saving={saving}
          onMove={me && me.canWrite !== false ? move : undefined}
          moving={moving}
          moveDisabled={saving != null || moving != null}
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
