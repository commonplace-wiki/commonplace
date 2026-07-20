import { NextResponse } from 'next/server'
import { getRepoConfig } from '@/lib/config'
import { GitHubError, listCollaborators } from '@/lib/repo'
import { getSession } from '@/lib/session'

/** People who can be @-mentioned in the editor: the repository's collaborators. */
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }
  const config = getRepoConfig()
  if (!config) {
    return NextResponse.json({ error: 'No wiki repository configured (set GIT_REPO)' }, { status: 500 })
  }
  try {
    const users = await listCollaborators(session.token, config)
    return NextResponse.json({ users })
  } catch (err) {
    // GitHub requires push access to list collaborators and GitLab 403s for
    // non-members. Someone who can edit but not enumerate people should get a
    // silent empty typeahead rather than an error while they are typing.
    if (err instanceof GitHubError && (err.status === 403 || err.status === 404)) {
      return NextResponse.json({ users: [] })
    }
    const status = err instanceof GitHubError ? err.status : 502
    const message = err instanceof Error ? err.message : 'Request failed'
    return NextResponse.json({ error: message }, { status })
  }
}
