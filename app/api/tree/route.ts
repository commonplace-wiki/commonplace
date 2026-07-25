import { NextResponse } from 'next/server'
import { fullPath, getRepoConfig, type RepoConfig } from '@/lib/config'
import { fetchFileMeta, getFile, GitHubError, listMarkdownFiles, repoExists } from '@/lib/repo'
import { ORDER_FILE, parseOrderMap, type OrderMap } from '@/lib/order'
import { clearedSessionCookie, getSession } from '@/lib/session'

async function fetchOrderMap(token: string | null, config: RepoConfig): Promise<OrderMap> {
  try {
    const file = await getFile(token, config, fullPath(config, ORDER_FILE))
    return parseOrderMap(file.content)
  } catch {
    // No order file (or unreadable): the sidebar falls back to title sort.
    return {}
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
      (await repoExists(token, config))
    ) {
      return NextResponse.json({ files: [], truncated: false, logo: null, order: {}, empty: true })
    }
    // A quota refusal is not a permission problem: bouncing the visitor to
    // sign-in (and from there to /setup) would point them at the wrong fix.
    // The shell shows a dedicated screen for this.
    if (err instanceof GitHubError && err.rateLimited) {
      return NextResponse.json(
        {
          error: 'Rate limit reached',
          rateLimited: true,
          resetAt: err.rateLimitResetAt,
        },
        { status: 429 }
      )
    }
    // Anonymous access to a private (or missing) repo: ask for sign-in
    // instead of surfacing GitHub's 404.
    if (!session && err instanceof GitHubError && [401, 403, 404].includes(err.status)) {
      return NextResponse.json({ error: 'Sign-in required' }, { status: 401 })
    }
    // A session whose token the provider no longer accepts (revoked app,
    // expired PAT). /api/me answers from the cookie alone and would keep
    // reporting "signed in", so the login page would bounce straight back
    // here — an endless redirect loop. Clearing the session breaks it: the
    // next /api/me answers 401 and the login page offers sign-in.
    if (session && err instanceof GitHubError && err.status === 401) {
      const res = NextResponse.json(
        { error: 'Your session is no longer valid. Sign in again.' },
        { status: 401 }
      )
      res.cookies.set(clearedSessionCookie())
      return res
    }
    const status = err instanceof GitHubError ? err.status : 502
    const message = err instanceof Error ? err.message : 'GitHub request failed'
    return NextResponse.json({ error: message }, { status })
  }
}
