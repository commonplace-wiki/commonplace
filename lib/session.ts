import crypto from 'crypto'
import { cookies } from 'next/headers'
import { getRepoConfig } from './config'

const SESSION_COOKIE = 'okf_session'

if (
  process.env.NODE_ENV === 'production' &&
  // `next build` imports route modules to collect page data with
  // NODE_ENV=production but without runtime secrets; only guard the real
  // server boot, not the build.
  process.env.NEXT_PHASE !== 'phase-production-build' &&
  !process.env.SESSION_SECRET
) {
  // Without a real secret, session cookies are sealed with a public constant
  // and can be forged. Refuse to boot rather than run insecure in production.
  throw new Error('SESSION_SECRET must be set in production (e.g. `openssl rand -hex 32`)')
}

const key = crypto
  .createHash('sha256')
  .update(process.env.SESSION_SECRET || 'commonplace-insecure-dev-secret')
  .digest()

export interface Session {
  token: string
  login: string
  avatarUrl: string
  authMethod: 'oauth' | 'github-app' | 'gitlab-oauth' | 'pat'
  /** GitHub App / GitLab OAuth tokens expire and come with a refresh token. */
  refreshToken?: string
  /** Epoch ms when `token` expires. */
  tokenExpiresAt?: number
}

export function seal(data: unknown): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64url')
}

export function unseal<T>(sealed: string): T | null {
  try {
    const buf = Buffer.from(sealed, 'base64url')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const enc = buf.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([decipher.update(enc), decipher.final()])
    return JSON.parse(dec.toString('utf8')) as T
  } catch {
    return null
  }
}

async function refreshSession(session: Session): Promise<Session | null> {
  try {
    let url: string
    let body: Record<string, string | undefined>
    if (session.authMethod === 'gitlab-oauth') {
      const host = getRepoConfig()?.host || 'gitlab.com'
      url = `https://${host}/oauth/token`
      body = {
        client_id: process.env.GITLAB_CLIENT_ID,
        client_secret: process.env.GITLAB_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
      }
    } else {
      url = 'https://github.com/login/oauth/access_token'
      body = {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
      }
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    const data = await res.json().catch(() => null)
    if (!data?.access_token) return null
    return {
      ...session,
      token: data.access_token,
      // Both providers rotate the refresh token on every use.
      refreshToken: data.refresh_token || session.refreshToken,
      tokenExpiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    }
  } catch {
    return null
  }
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies()
  const raw = store.get(SESSION_COOKIE)?.value
  if (!raw) return null
  const session = unseal<Session>(raw)
  if (!session || !session.token) return null
  if (session.tokenExpiresAt && Date.now() > session.tokenExpiresAt - 60_000) {
    if (!session.refreshToken) return null
    const refreshed = await refreshSession(session)
    if (!refreshed) return null
    try {
      store.set(sessionCookie(refreshed))
    } catch {
      // Read-only cookie context (e.g. server component): the refreshed
      // token still serves this request; the cookie updates on the next
      // route-handler request.
    }
    return refreshed
  }
  return session
}

export function sessionCookie(session: Session) {
  return {
    name: SESSION_COOKIE,
    value: seal(session),
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  }
}

export function clearedSessionCookie() {
  return {
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  }
}
