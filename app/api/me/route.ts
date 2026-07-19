import { NextResponse } from 'next/server'
import { getRepoConfig } from '@/lib/config'
import { canWrite } from '@/lib/repo'
import { getSession } from '@/lib/session'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  // Effective write access to the wiki repo, so a broken setup surfaces as
  // a banner instead of a 403 on the first save.
  const config = getRepoConfig()
  const can = config ? await canWrite(session.token, config, session.authMethod) : null

  return NextResponse.json({
    login: session.login,
    avatarUrl: session.avatarUrl,
    authMethod: session.authMethod,
    profileUrl: config?.provider === 'gitlab'
      ? `https://${config.host}/${session.login}`
      : `https://github.com/${session.login}`,
    canWrite: can,
  })
}
