import { NextRequest, NextResponse } from 'next/server'
import { fullPath, getRepoConfig, type RepoConfig } from '@/lib/config'
import { getFile, GitHubError, movePaths, putFile, type PathMove } from '@/lib/repo'
import { appendLogEntry, type LogAction } from '@/lib/okf'
import { ORDER_FILE, orderName, parseOrderMap, serializeOrderMap } from '@/lib/order'
import { getSession } from '@/lib/session'

/** The directory subtree of a node: the path itself for a folder, without .md for a page. */
function subtreeOf(nodePath: string): string {
  return nodePath.endsWith('.md') ? nodePath.slice(0, -3) : nodePath
}

/** Parent directory of a node path ('' at the top level). */
function parentOf(nodePath: string): string {
  return nodePath.includes('/') ? nodePath.slice(0, nodePath.lastIndexOf('/')) : ''
}

/** Validate and normalize the optional destination order from the request. */
function parseDestOrder(raw: unknown): { dir: string; children: string[] } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  if (typeof record.dir !== 'string') return undefined
  if (!Array.isArray(record.children)) return undefined
  const names = record.children
    .filter((c): c is string => typeof c === 'string' && c.trim() !== '' && !/[/\\]/.test(c))
    .map((c) => orderName(c.trim()))
  if (!names.length) return undefined
  return { dir: record.dir.replace(/^\/+|\/+$/g, ''), children: names }
}

/**
 * Keep .commonplace/order.yaml in step with a move: a rename in place keeps
 * the page's position, a move to another directory drops its entry (unlisted
 * pages sort by title), order entries for directories inside the moved subtree
 * follow the move, and an explicit destination order (when given) is applied so
 * the node lands exactly where the sidebar expects.
 */
async function syncOrderAfterMove(
  token: string,
  config: RepoConfig,
  fromNode: string,
  toNode: string,
  destOrder?: { dir: string; children: string[] }
) {
  try {
    const repoPath = fullPath(config, ORDER_FILE)
    let file
    try {
      file = await getFile(token, config, repoPath)
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) {
        // No order file yet: only an explicit destination order is worth writing.
        if (!destOrder) return
      } else {
        throw err
      }
    }
    const map = file ? parseOrderMap(file.content) : {}
    let changed = false

    const fromDir = parentOf(fromNode)
    const toDir = parentOf(toNode)
    const list = map[fromDir]
    const idx = list ? list.indexOf(orderName(fromNode)) : -1
    if (list && idx !== -1) {
      if (fromDir === toDir) list[idx] = orderName(toNode)
      else list.splice(idx, 1)
      if (!list.length) delete map[fromDir]
      changed = true
    }

    const fromSubtree = subtreeOf(fromNode)
    const toSubtree = subtreeOf(toNode)
    for (const key of Object.keys(map)) {
      if (key === fromSubtree || key.startsWith(`${fromSubtree}/`)) {
        map[toSubtree + key.slice(fromSubtree.length)] = map[key]
        delete map[key]
        changed = true
      }
    }

    if (destOrder) {
      map[destOrder.dir] = destOrder.children
      changed = true
    }

    if (!changed) return
    await putFile(
      token,
      config,
      repoPath,
      serializeOrderMap(map),
      `Update sidebar order after move of ${fromNode}`,
      file?.sha
    )
  } catch {
    // best effort only
  }
}

async function logMove(token: string, config: RepoConfig, toNode: string, title: string) {
  try {
    const logRepoPath = fullPath(config, 'log.md')
    let existing: string | null = null
    let sha: string | undefined
    try {
      const file = await getFile(token, config, logRepoPath)
      existing = file.content
      sha = file.sha
    } catch (err) {
      if (!(err instanceof GitHubError && err.status === 404)) throw err
    }
    const today = new Date().toISOString().slice(0, 10)
    const action: LogAction = 'Move'
    const updated = appendLogEntry(existing, action, toNode, title, today)
    await putFile(token, config, logRepoPath, updated, `Log move of ${toNode}`, sha)
  } catch {
    // best effort only
  }
}

/**
 * Move a node — a page (with its same-named subpage directory) or a folder
 * without its own page (with everything under it) — to another parent
 * directory, optionally renaming it. Writes go through the Git Data API; the
 * caller may pass an explicit destination order so the node lands at a chosen
 * position instead of the title-sort fallback.
 */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const config = getRepoConfig()
  if (!config) {
    return NextResponse.json({ error: 'No wiki repository configured (set GIT_REPO)' }, { status: 500 })
  }

  const payload = await req.json().catch(() => null)
  const path = typeof payload?.path === 'string' ? payload.path.replace(/^\/+/, '') : ''
  const toDir = typeof payload?.toDir === 'string' ? payload.toDir.trim().replace(/^\/+|\/+$/g, '') : ''
  const isPage = path.endsWith('.md')
  let name =
    typeof payload?.newName === 'string' && payload.newName.trim()
      ? payload.newName.trim()
      : path.split('/').pop() || ''
  if (isPage && !name.endsWith('.md')) name = `${name}.md`

  try {
    if (!path) throw new Error('A path is required')
    if (/[/\\]/.test(name)) throw new Error('The new name cannot contain slashes')
    fullPath(config, path)
    const toNode = toDir ? `${toDir}/${name}` : name
    fullPath(config, toNode)
    if (toNode === path) {
      return NextResponse.json({ error: 'The page is already there' }, { status: 400 })
    }
    const fromSubtree = subtreeOf(path)
    const toSubtree = subtreeOf(toNode)
    if (toDir === fromSubtree || toDir.startsWith(`${fromSubtree}/`)) {
      return NextResponse.json({ error: 'Cannot move a node below its own subpages' }, { status: 400 })
    }

    const moves: PathMove[] = isPage
      ? [
          { from: fullPath(config, path), to: fullPath(config, toNode) },
          { from: fullPath(config, fromSubtree), to: fullPath(config, toSubtree) },
        ]
      : [{ from: fullPath(config, fromSubtree), to: fullPath(config, toSubtree) }]
    // Bundle-absolute links inside the moved files that point at the moved
    // subtree (subpages, their assets, the page itself) must follow the move.
    const rewriteLinks = (_repoPath: string, content: string) =>
      content
        .split(`](/${path})`)
        .join(`](/${toNode})`)
        .split(`](/${fromSubtree}/`)
        .join(`](/${toSubtree}/`)
    const moved = await movePaths(
      session.token,
      config,
      moves,
      `Move ${path} to ${toNode}`,
      rewriteLinks
    )

    await syncOrderAfterMove(session.token, config, path, toNode, parseDestOrder(payload?.order))

    const title = typeof payload?.title === 'string' && payload.title ? payload.title : toNode
    if (payload?.updateLog !== false) {
      await logMove(session.token, config, toNode, title)
    }
    return NextResponse.json({ path: toNode, moved })
  } catch (err) {
    if (err instanceof GitHubError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Move failed' }, { status: 400 })
  }
}
