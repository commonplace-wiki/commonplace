import { NextRequest, NextResponse } from 'next/server'
import { getRepoConfig } from '@/lib/config'
import { GitHubError, providerLabel, userInfo } from '@/lib/repo'
import { sessionCookie } from '@/lib/session'

/** Sign in with a personal access token instead of the OAuth flow. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 })
  }
  const config = getRepoConfig()
  if (!config) {
    return NextResponse.json({ error: 'No wiki repository configured (set GIT_REPO)' }, { status: 500 })
  }
  try {
    const user = await userInfo(token, config)
    const res = NextResponse.json({ login: user.login })
    res.cookies.set(
      sessionCookie({
        token,
        login: user.login,
        avatarUrl: user.avatarUrl,
        authMethod: 'pat',
      })
    )
    return res
  } catch (err) {
    const status = err instanceof GitHubError && err.status === 401 ? 401 : 502
    return NextResponse.json({ error: `${providerLabel(config)} rejected this token` }, { status })
  }
}
