import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getRepoConfig, type RepoConfig } from '@/lib/config'
import { localLogin } from '@/lib/local'
import { sessionCookie, type Session } from '@/lib/session'
import { publicUrl } from '@/lib/url'

/**
 * A local repository has no identity provider: "signing in" just creates a
 * session for the machine's git identity, with a generated initial avatar.
 */
async function localSignIn(req: NextRequest, config: RepoConfig) {
  const login = await localLogin(config)
  const initial = /^[a-z0-9]/i.test(login) ? login[0].toUpperCase() : '?'
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
    '<rect width="64" height="64" rx="32" fill="#556270"/>' +
    `<text x="32" y="43" font-family="sans-serif" font-size="30" fill="#fff" text-anchor="middle">${initial}</text>` +
    '</svg>'
  const session: Session = {
    token: 'local',
    login,
    avatarUrl: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    authMethod: 'local',
  }
  const res = NextResponse.redirect(publicUrl('/', req))
  res.cookies.set(sessionCookie(session))
  return res
}

export async function GET(req: NextRequest) {
  const config = getRepoConfig()
  if (config?.provider === 'local') {
    return localSignIn(req, config)
  }
  const state = crypto.randomBytes(16).toString('hex')
  const callback = publicUrl('/api/auth/callback', req).toString()

  let authorize: URL
  if (config?.provider === 'gitlab') {
    const clientId = process.env.GITLAB_CLIENT_ID
    if (!clientId) {
      return NextResponse.redirect(publicUrl('/?error=oauth_unconfigured', req))
    }
    authorize = new URL(`https://${config.host}/oauth/authorize`)
    authorize.searchParams.set('client_id', clientId)
    authorize.searchParams.set('redirect_uri', callback)
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('scope', 'api')
    authorize.searchParams.set('state', state)
  } else {
    const clientId = process.env.GITHUB_CLIENT_ID
    if (!clientId) {
      return NextResponse.redirect(publicUrl('/?error=oauth_unconfigured', req))
    }
    authorize = new URL('https://github.com/login/oauth/authorize')
    authorize.searchParams.set('client_id', clientId)
    authorize.searchParams.set('redirect_uri', callback)
    // GitHub App client ids start with "Iv", OAuth App ids with "Ov". GitHub
    // Apps ignore scopes: permissions come from the app and its installation,
    // which also keeps the consent screen minimal.
    if (!clientId.startsWith('Iv')) {
      authorize.searchParams.set('scope', 'repo read:user')
    }
    authorize.searchParams.set('state', state)
  }

  const res = NextResponse.redirect(authorize)
  res.cookies.set({
    name: 'okf_oauth_state',
    value: state,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })
  return res
}
