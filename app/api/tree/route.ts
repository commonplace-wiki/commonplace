import { NextResponse } from 'next/server'
import { fullPath, getRepoConfig, type RepoConfig } from '@/lib/config'
import { fetchFileMeta, getFile, gh, GitHubError, listMarkdownFiles } from '@/lib/github'
import { ORDER_FILE, parseOrderMap, type OrderMap } from '@/lib/order'
import { getSession } from '@/lib/session'

async function fetchOrderMap(token: string | null, config: RepoConfig): Promise<OrderMap> {
  try {
    const file = await getFile(token, config, fullPath(config, ORDER_FILE))
    return parseOrderMap(file.content)
  } catch {
    // No order file (or unreadable): the sidebar falls back to title sort.
    return {}
  }
}

/**
 * A tree 404/409 can mean "repo missing or no access" but also "repo exists
 * and has no commits yet (or the branch does not exist)". Only the latter
 * should render as an empty wiki instead of an error.
 */
async function repoIsEmpty(token: string | null, config: RepoConfig): Promise<boolean> {
  try {
    await gh(token, `/repos/${config.owner}/${config.repo}`)
    return true
  } catch {
    return false
  }
}

export async function GET() {
  const session = await getSession()
  const config = getRepoConfig()
  if (!config) {
    return NextResponse.json(
      { error: 'No wiki repository configured (set GIT_REPO)' },
      { status: 500 }
    )
  }
  const token = session?.token ?? null
  try {
    const { files, truncated, logo } = await listMarkdownFiles(token, config)
    const [meta, order] = await Promise.all([
      fetchFileMeta(
        token,
        config,
        files.map((f) => f.path)
      ),
      fetchOrderMap(token, config),
    ])
    return NextResponse.json({
      files: files.map((f) => ({
        path: f.path,
        title: meta[f.path]?.title || null,
        hidden: meta[f.path]?.hidden || false,
      })),
      truncated,
      logo,
      order,
    })
  } catch (err) {
    // Brand-new wiki: the repo exists but has no commits (or the configured
    // branch does not exist yet). That is an empty wiki, not an error — the
    // first saved page creates the branch.
    if (
      err instanceof GitHubError &&
      [404, 409].includes(err.status) &&
      (await repoIsEmpty(token, config))
    ) {
      return NextResponse.json({ files: [], truncated: false, logo: null, order: {}, empty: true })
    }
    // Anonymous access to a private (or missing) repo: ask for sign-in
    // instead of surfacing GitHub's 404.
    if (!session && err instanceof GitHubError && [401, 403, 404].includes(err.status)) {
      return NextResponse.json({ error: 'Sign-in required' }, { status: 401 })
    }
    const status = err instanceof GitHubError ? err.status : 502
    const message = err instanceof Error ? err.message : 'GitHub request failed'
    return NextResponse.json({ error: message }, { status })
  }
}
