import { NextRequest, NextResponse } from 'next/server'
import { gh } from '@/lib/github'
import { sessionCookie } from '@/lib/session'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const expectedState = req.cookies.get('okf_oauth_state')?.value

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL('/?error=oauth_state', req.url))
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
    cache: 'no-store',
  })
  const tokenData = await tokenRes.json().catch(() => null)
  const accessToken = tokenData?.access_token
  if (!accessToken) {
    return NextResponse.redirect(new URL('/?error=oauth_exchange', req.url))
  }

  let user
  try {
    user = await gh(accessToken, '/user')
  } catch {
    return NextResponse.redirect(new URL('/?error=oauth_user', req.url))
  }

  const isGitHubApp = (process.env.GITHUB_CLIENT_ID || '').startsWith('Iv')
  const res = NextResponse.redirect(new URL('/', req.url))
  res.cookies.set(
    sessionCookie({
      token: accessToken,
      login: user.login,
      avatarUrl: user.avatar_url,
      authMethod: isGitHubApp ? 'github-app' : 'oauth',
      // GitHub App user tokens expire (default 8h) and are refreshed
      // transparently in getSession().
      ...(tokenData.refresh_token
        ? {
            refreshToken: tokenData.refresh_token,
            tokenExpiresAt: Date.now() + (tokenData.expires_in || 8 * 3600) * 1000,
          }
        : {}),
    })
  )
  res.cookies.set({ name: 'okf_oauth_state', value: '', path: '/', maxAge: 0 })
  return res
}
