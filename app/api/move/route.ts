import { NextRequest, NextResponse } from 'next/server'
import { fullPath, getRepoConfig, type RepoConfig } from '@/lib/config'
import { getFile, GitHubError, movePaths, putFile, type PathMove } from '@/lib/repo'
import { appendLogEntry, type LogAction } from '@/lib/okf'
import { ORDER_FILE, orderName, parseOrderMap, serializeOrderMap } from '@/lib/order'
import { getSession } from '@/lib/session'

/**
 * Keep .commonplace/order.yaml in step with a move: a rename in place keeps
 * the page's position, a move to another directory drops its entry (unlisted
 * pages sort by title), and order entries for directories inside the moved
 * subtree follow the move.
 */
async function syncOrderAfterMove(token: string, config: RepoConfig, fromFile: string, toFile: string) {
  try {
    const repoPath = fullPath(config, ORDER_FILE)
    let file
    try {
      file = await getFile(token, config, repoPath)
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return
      throw err
    }
    const map = parseOrderMap(file.content)
    let changed = false

    const fromDir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : ''
    const toDir = toFile.includes('/') ? toFile.slice(0, toFile.lastIndexOf('/')) : ''
    const list = map[fromDir]
    const idx = list ? list.indexOf(orderName(fromFile)) : -1
    if (list && idx !== -1) {
      if (fromDir === toDir) list[idx] = orderName(toFile)
      else list.splice(idx, 1)
      if (!list.length) delete map[fromDir]
      changed = true
    }

    const fromSubtree = fromFile.slice(0, -3)
    const toSubtree = toFile.slice(0, -3)
    for (const key of Object.keys(map)) {
      if (key === fromSubtree || key.startsWith(`${fromSubtree}/`)) {
        map[toSubtree + key.slice(fromSubtree.length)] = map[key]
        delete map[key]
        changed = true
      }
    }

    if (!changed) return
    await putFile(
      token,
      config,
      repoPath,
      serializeOrderMap(map),
      `Update sidebar order after move of ${fromFile}`,
      file.sha
    )
  } catch {
    // best effort only
  }
}

async function logMove(token: string, config: RepoConfig, toFile: string, title: string) {
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
    const updated = appendLogEntry(existing, action, toFile, title, today)
    await putFile(token, config, logRepoPath, updated, `Log move of ${toFile}`, sha)
  } catch {
    // best effort only
  }
}

/**
 * Move a page (and its subpage directory, if any) to another parent directory,
 * optionally renaming it. One commit via the Git Data API.
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
  let name =
    typeof payload?.newName === 'string' && payload.newName.trim()
      ? payload.newName.trim()
      : path.split('/').pop() || ''
  if (!name.endsWith('.md')) name = `${name}.md`

  try {
    if (!path.endsWith('.md')) throw new Error('Path must point to a .md file')
    if (/[/\\]/.test(name)) throw new Error('The new name cannot contain slashes')
    fullPath(config, path)
    const toFile = toDir ? `${toDir}/${name}` : name
    fullPath(config, toFile)
    if (toFile === path) {
      return NextResponse.json({ error: 'The page is already there' }, { status: 400 })
    }
    const fromSubtree = path.slice(0, -3)
    const toSubtree = toFile.slice(0, -3)
    if (toDir === fromSubtree || toDir.startsWith(`${fromSubtree}/`)) {
      return NextResponse.json({ error: 'Cannot move a page below its own subpages' }, { status: 400 })
    }

    const moves: PathMove[] = [
      { from: fullPath(config, path), to: fullPath(config, toFile) },
      { from: fullPath(config, fromSubtree), to: fullPath(config, toSubtree) },
    ]
    // Bundle-absolute links inside the moved files that point at the moved
    // subtree (subpages, their assets, the page itself) must follow the move.
    const rewriteLinks = (_repoPath: string, content: string) =>
      content
        .split(`](/${path})`)
        .join(`](/${toFile})`)
        .split(`](/${fromSubtree}/`)
        .join(`](/${toSubtree}/`)
    const moved = await movePaths(
      session.token,
      config,
      moves,
      `Move ${path} to ${toFile}`,
      rewriteLinks
    )

    await syncOrderAfterMove(session.token, config, path, toFile)

    const title = typeof payload?.title === 'string' && payload.title ? payload.title : toFile
    if (payload?.updateLog !== false) {
      await logMove(session.token, config, toFile, title)
    }
    return NextResponse.json({ path: toFile, moved })
  } catch (err) {
    if (err instanceof GitHubError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Move failed' }, { status: 400 })
  }
}
