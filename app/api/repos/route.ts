import { NextResponse } from 'next/server'
import { gh, GitHubError } from '@/lib/github'
import { getSession } from '@/lib/session'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }
  try {
    const repos = await gh(session.token, '/user/repos?per_page=100&sort=pushed')
    return NextResponse.json({
      repos: (repos as any[]).map((r) => ({
        fullName: r.full_name,
        owner: r.owner.login,
        name: r.name,
        defaultBranch: r.default_branch,
        private: r.private,
        description: r.description,
      })),
    })
  } catch (err) {
    const status = err instanceof GitHubError ? err.status : 502
    const message = err instanceof Error ? err.message : 'GitHub request failed'
    return NextResponse.json({ error: message }, { status })
  }
}
