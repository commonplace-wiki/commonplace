import { NextRequest, NextResponse } from 'next/server'
import { gh, GitHubError } from '@/lib/github'
import { sessionCookie } from '@/lib/session'

/** Sign in with a personal access token instead of the OAuth flow. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 })
  }
  try {
    const user = await gh(token, '/user')
    const res = NextResponse.json({ login: user.login })
    res.cookies.set(
      sessionCookie({
        token,
        login: user.login,
        avatarUrl: user.avatar_url,
        authMethod: 'pat',
      })
    )
    return res
  } catch (err) {
    const status = err instanceof GitHubError && err.status === 401 ? 401 : 502
    return NextResponse.json({ error: 'GitHub rejected this token' }, { status })
  }
}
