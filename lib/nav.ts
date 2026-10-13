import type { WikiFile } from '@/components/Shell'

/**
 * Navigation tree for the sidebar, derived from the wiki's markdown files and
 * the sidebar order in `.commonplace/order.yaml`.
 *
 * This is the single source of truth for both the sidebar's display order and
 * the hierarchical section numbers shown in the sidebar and on pages.
 */

export interface Node {
  /** Display label: frontmatter title, or a prettified filename. */
  title: string
  /** Directory path (for dirs) or file path (for pages). */
  path: string
  isDir: boolean
  /** For a directory that also has a same-named page (Confluence-style parent page). */
  pagePath?: string
  /** Hierarchical section number, e.g. "1.2.3". Assigned by `buildTree`. */
  number: string
  children: Node[]
}

export type OrderMap = Record<string, string[]>

export function pretty(name: string): string {
  return name.replace(/\.md$/, '').replace(/[-_]/g, ' ')
}

/** Node name as used in order.yaml lists: basename without the .md suffix. */
export function orderKey(path: string): string {
  return (path.split('/').pop() || path).replace(/\.md$/, '')
}

export function buildTree(files: WikiFile[], order: OrderMap): Node[] {
  const root: Node = { title: '', path: '', isDir: true, number: '', children: [] }
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
      number: '',
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
      number: '',
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

  numberTree(root.children, '')
  return root.children
}

/** Assign hierarchical section numbers ("1", "1.2", "1.2.3") in display order. */
function numberTree(nodes: Node[], prefix: string) {
  nodes.forEach((node, i) => {
    node.number = prefix ? `${prefix}.${i + 1}` : `${i + 1}`
    numberTree(node.children, node.number)
  })
}

/**
 * Map every node's path — and, for a merged folder/page, its page path — to its
 * section number, so the page view can show the same number the sidebar shows.
 */
export function numberByPath(nodes: Node[]): Map<string, string> {
  const map = new Map<string, string>()
  const walk = (list: Node[]) => {
    for (const node of list) {
      map.set(node.path, node.number)
      if (node.pagePath) map.set(node.pagePath, node.number)
      walk(node.children)
    }
  }
  walk(nodes)
  return map
}

/** Map each directory path ('' for the root) to its ordered child nodes. */
export function childrenByDir(nodes: Node[]): Map<string, Node[]> {
  const map = new Map<string, Node[]>()
  const walk = (list: Node[], dir: string) => {
    map.set(dir, list)
    for (const node of list) {
      if (node.isDir) walk(node.children, node.path)
    }
  }
  walk(nodes, '')
  return map
}

export type MoveDirection = 'in' | 'out'

/** Parent directory of a node path ('' at the top level). */
export function parentDir(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

/** Directory a node moves into when another node is indented under it. */
export function subtreeDir(node: Node): string {
  return node.isDir ? node.path : node.path.slice(0, -3)
}

/**
 * Where a node lands when indented under its preceding sibling or outdented to
 * its parent's level, plus the destination directory's child order. Returns
 * null when the move is not possible (no preceding sibling, or top level).
 */
export function planMove(
  children: Map<string, Node[]>,
  node: Node,
  direction: MoveDirection
): { toDir: string; children: string[] } | null {
  const dir = parentDir(node.path)
  const group = children.get(dir) ?? []
  const index = group.findIndex((n) => n.path === node.path)
  if (index === -1) return null

  if (direction === 'in') {
    if (index === 0) return null
    const toDir = subtreeDir(group[index - 1])
    return {
      toDir,
      children: [...(children.get(toDir) ?? []).map((n) => orderKey(n.path)), orderKey(node.path)],
    }
  }

  if (dir === '') return null
  const toDir = parentDir(dir)
  const names = (children.get(toDir) ?? []).map((n) => orderKey(n.path))
  const moved = orderKey(node.path)
  const at = names.indexOf(orderKey(dir))
  if (at === -1) names.push(moved)
  else names.splice(at + 1, 0, moved)
  return { toDir, children: names }
}

/**
 * Remap a moved node's file paths to their destination, for the sidebar's
 * optimistic update. Mirrors the move API's subtree logic: the node's page (if
 * any) and everything under its subtree directory move together.
 */
export function remapMovedFiles(files: WikiFile[], node: Node, toDir: string): WikiFile[] {
  const name = orderKey(node.path)
  const toSubtree = toDir ? `${toDir}/${name}` : name
  const fromSubtree = node.isDir ? node.path : node.path.slice(0, -3)
  const fromPage = node.isDir ? node.pagePath ?? null : node.path
  const toPage = fromPage ? `${toSubtree}.md` : null
  return files.map((f) => {
    if (fromPage && toPage && f.path === fromPage) return { ...f, path: toPage }
    if (f.path === fromSubtree || f.path.startsWith(`${fromSubtree}/`)) {
      return { ...f, path: toSubtree + f.path.slice(fromSubtree.length) }
    }
    return f
  })
}
