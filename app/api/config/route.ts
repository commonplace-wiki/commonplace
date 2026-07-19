import { NextRequest, NextResponse } from 'next/server'
import { clearedConfigCookie, configCookie, envRepoConfig, getRepoConfig } from '@/lib/config'
import { getSession } from '@/lib/session'

export async function GET() {
  const config = await getRepoConfig()
  return NextResponse.json({ config, fixed: envRepoConfig() !== null })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }
  if (envRepoConfig()) {
    return NextResponse.json(
      { error: 'The wiki repository is fixed by the deployment (WIKI_REPO)' },
      { status: 403 }
    )
  }
  const body = await req.json().catch(() => null)
  const owner = typeof body?.owner === 'string' ? body.owner.trim() : ''
  const repo = typeof body?.repo === 'string' ? body.repo.trim() : ''
  const branch = typeof body?.branch === 'string' && body.branch.trim() ? body.branch.trim() : 'main'
  const root = typeof body?.root === 'string' ? body.root.trim().replace(/^\/+|\/+$/g, '') : ''
  if (!owner || !repo) {
    return NextResponse.json({ error: 'owner and repo are required' }, { status: 400 })
  }
  const config = { provider: 'github' as const, owner, repo, branch, root }
  const res = NextResponse.json({ config })
  res.cookies.set(configCookie(config))
  return res
}

export async function DELETE() {
  if (envRepoConfig()) {
    return NextResponse.json(
      { error: 'The wiki repository is fixed by the deployment (WIKI_REPO)' },
      { status: 403 }
    )
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(clearedConfigCookie())
  return res
}
