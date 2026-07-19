import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getRepoConfig } from '@/lib/config'

export async function GET(req: NextRequest) {
  const config = getRepoConfig()
  const state = crypto.randomBytes(16).toString('hex')
  const callback = new URL('/api/auth/callback', req.url).toString()

  let authorize: URL
  if (config?.provider === 'gitlab') {
    const clientId = process.env.GITLAB_CLIENT_ID
    if (!clientId) {
      return NextResponse.redirect(new URL('/?error=oauth_unconfigured', req.url))
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
      return NextResponse.redirect(new URL('/?error=oauth_unconfigured', req.url))
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
