import { NextResponse } from 'next/server'
import { getRepoConfig } from '@/lib/config'
import { getSession } from '@/lib/session'

/**
 * Who is signed in. Answers from the session cookie alone, with no provider
 * round-trip, because the shell blocks its first paint on this. Whether the
 * token can actually write is a separate, slower question — see ./access.
 */
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  const config = getRepoConfig()

  return NextResponse.json({
    login: session.login,
    avatarUrl: session.avatarUrl,
    authMethod: session.authMethod,
    profileUrl: config?.provider === 'gitlab'
      ? `https://${config.host}/${session.login}`
      : `https://github.com/${session.login}`,
  })
}
