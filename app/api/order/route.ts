import { NextRequest, NextResponse } from 'next/server'
import { fullPath, getRepoConfig } from '@/lib/config'
import { getFile, GitHubError, putFile } from '@/lib/repo'
import { ORDER_FILE, orderName, parseOrderMap, serializeOrderMap, type OrderMap } from '@/lib/order'
import { getSession } from '@/lib/session'

/**
 * Persist the sidebar order of one directory's children as a single commit
 * to .commonplace/order.yaml, leaving every other directory's entry alone.
 */
export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const config = getRepoConfig()
  if (!config) {
    return NextResponse.json({ error: 'No wiki repository configured (set GIT_REPO)' }, { status: 500 })
  }

  const payload = await req.json().catch(() => null)
  const dir = typeof payload?.dir === 'string' ? payload.dir.replace(/^\/+|\/+$/g, '') : null
  const children: unknown = payload?.children
  if (
    dir === null ||
    !Array.isArray(children) ||
    children.length === 0 ||
    !children.every((c) => typeof c === 'string' && c.trim() && !/[/\\]/.test(c))
  ) {
    return NextResponse.json({ error: 'dir and a non-empty children[] of names required' }, { status: 400 })
  }
  const names = (children as string[]).map((c) => orderName(c.trim()))

  const repoPath = fullPath(config, ORDER_FILE)
  // Read-modify-write with one retry, so two people reordering different
  // directories at the same time both land.
  for (let attempt = 0; ; attempt++) {
    let map: OrderMap = {}
    let sha: string | undefined
    try {
      const file = await getFile(session.token, config, repoPath)
      map = parseOrderMap(file.content)
      sha = file.sha
    } catch (err) {
      if (!(err instanceof GitHubError && err.status === 404)) {
        const status = err instanceof GitHubError ? err.status : 502
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Read failed' }, { status })
      }
    }
    map[dir] = names
    try {
      await putFile(
        session.token,
        config,
        repoPath,
        serializeOrderMap(map),
        `Reorder pages in ${dir || 'wiki root'}`,
        sha
      )
      return NextResponse.json({ order: map })
    } catch (err) {
      if (err instanceof GitHubError && err.status === 409 && attempt === 0) continue
      const status = err instanceof GitHubError ? err.status : 502
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Save failed' }, { status })
    }
  }
}
