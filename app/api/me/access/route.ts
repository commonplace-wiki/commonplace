import { NextResponse } from 'next/server'
import { getRepoConfig } from '@/lib/config'
import { canWrite } from '@/lib/repo'
import { getSession } from '@/lib/session'

/**
 * Effective write access of the session's token to the wiki repo, so a broken
 * setup surfaces as a banner instead of a 403 on the first save.
 *
 * Split out of /api/me because answering it costs several provider round-trips
 * (for GitHub Apps, resolving which repositories the installation covers) and
 * it only drives a warning banner and the sidebar's drag-to-reorder. Callers
 * treat an unknown answer as permissive, so this may land well after boot.
 *
 * `canWrite: null` means undetermined, not "no".
 */
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }
  const config = getRepoConfig()
  const can = config ? await canWrite(session.token, config, session.authMethod) : null
  return NextResponse.json({ canWrite: can })
}
