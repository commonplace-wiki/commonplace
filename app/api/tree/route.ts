import { NextResponse } from 'next/server'
import { getRepoConfig } from '@/lib/config'
import { fetchFileMeta, GitHubError, listMarkdownFiles } from '@/lib/github'
import { getSession } from '@/lib/session'

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
    const meta = await fetchFileMeta(
      token,
      config,
      files.map((f) => f.path)
    )
    return NextResponse.json({
      files: files.map((f) => ({
        path: f.path,
        title: meta[f.path]?.title || null,
        hidden: meta[f.path]?.hidden || false,
      })),
      truncated,
      logo,
    })
  } catch (err) {
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
