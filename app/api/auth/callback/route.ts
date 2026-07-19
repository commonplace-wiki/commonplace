import { NextRequest, NextResponse } from 'next/server'
import { getRepoConfig } from '@/lib/config'
import { publicUrl } from '@/lib/url'
import { gh } from '@/lib/github'
import { gl } from '@/lib/gitlab'
import { sessionCookie, type Session } from '@/lib/session'

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const expectedState = req.cookies.get('okf_oauth_state')?.value

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(publicUrl('/?error=oauth_state', req))
  }

  const config = getRepoConfig()
  const callback = publicUrl('/api/auth/callback', req).toString()

  let session: Session
  if (config?.provider === 'gitlab') {
    const tokenRes = await fetch(`https://${config.host}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITLAB_CLIENT_ID,
        client_secret: process.env.GITLAB_CLIENT_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: callback,
        code,
      }),
      cache: 'no-store',
    })
    const tokenData = await tokenRes.json().catch(() => null)
    const accessToken = tokenData?.access_token
    if (!accessToken) {
      return NextResponse.redirect(publicUrl('/?error=oauth_exchange', req))
    }
    let user
    try {
      user = await gl(accessToken, config, '/user')
    } catch {
      return NextResponse.redirect(publicUrl('/?error=oauth_user', req))
    }
    session = {
      token: accessToken,
      login: user.username,
      avatarUrl: user.avatar_url || '',
      authMethod: 'gitlab-oauth',
      ...(tokenData.refresh_token
        ? {
            refreshToken: tokenData.refresh_token,
            tokenExpiresAt: Date.now() + (tokenData.expires_in || 7200) * 1000,
          }
        : {}),
    }
  } else {
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
      return NextResponse.redirect(publicUrl('/?error=oauth_exchange', req))
    }
    let user
    try {
      user = await gh(accessToken, '/user')
    } catch {
      return NextResponse.redirect(publicUrl('/?error=oauth_user', req))
    }
    const isGitHubApp = (process.env.GITHUB_CLIENT_ID || '').startsWith('Iv')
    session = {
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
    }
  }

  const res = NextResponse.redirect(publicUrl('/', req))
  res.cookies.set(sessionCookie(session))
  res.cookies.set({ name: 'okf_oauth_state', value: '', path: '/', maxAge: 0 })
  return res
}
