import { NextResponse } from 'next/server'
import { getRepoConfig, type RepoConfig } from '@/lib/config'
import { gh } from '@/lib/github'
import { getSession } from '@/lib/session'

/**
 * For GitHub App user tokens, /repos/{owner}/{repo} reports the USER's
 * permission, not the token's: an org owner sees push=true even when the
 * app is not installed on the repo and every write would 403 with
 * "Resource not accessible by integration". /user/installations answers
 * the real question: which repos this app token can reach.
 */
async function appInstalledOnRepo(token: string, config: RepoConfig): Promise<boolean | null> {
  try {
    const data = await gh(token, '/user/installations?per_page=50')
    const fullName = `${config.owner}/${config.repo}`.toLowerCase()
    for (const inst of data?.installations || []) {
      for (let page = 1; page <= 10; page++) {
        const repos = await gh(
          token,
          `/user/installations/${inst.id}/repositories?per_page=100&page=${page}`
        )
        const list: { full_name?: string }[] = repos?.repositories || []
        if (list.some((r) => (r.full_name || '').toLowerCase() === fullName)) return true
        if (list.length < 100) break
      }
    }
    return false
  } catch {
    // Not a GitHub App token, or the endpoint is unavailable: undetermined.
    return null
  }
}

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  // Effective write access to the wiki repo, so a broken setup surfaces as
  // a banner instead of a 403 on the first save.
  let canWrite: boolean | null = null
  const config = getRepoConfig()
  if (config) {
    try {
      const repo = await gh(session.token, `/repos/${config.owner}/${config.repo}`)
      canWrite = Boolean(repo?.permissions?.push)
    } catch {
      canWrite = false
    }
    if (canWrite && session.authMethod === 'github-app') {
      const installed = await appInstalledOnRepo(session.token, config)
      if (installed === false) canWrite = false
    }
  }

  return NextResponse.json({
    login: session.login,
    avatarUrl: session.avatarUrl,
    authMethod: session.authMethod,
    canWrite,
  })
}
