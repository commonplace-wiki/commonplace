import { NextRequest, NextResponse } from 'next/server'
import yaml from 'js-yaml'
import { fullPath, getRepoConfig } from '@/lib/config'
import { getFile, GitHubError, putFile } from '@/lib/github'
import { getSession } from '@/lib/session'

/** Wiki-level settings, stored under .wiki/ in the connected repository. */
export interface WikiSettings {
  name: string
  description: string
  default_type: string
  update_log: boolean
}

const SETTINGS_FILE = '.wiki/settings.yaml'

const DEFAULTS: WikiSettings = {
  name: '',
  description: '',
  default_type: 'Wiki Page',
  update_log: true,
}

function sanitize(raw: any): WikiSettings {
  return {
    name: typeof raw?.name === 'string' ? raw.name.trim() : DEFAULTS.name,
    description: typeof raw?.description === 'string' ? raw.description.trim() : DEFAULTS.description,
    default_type:
      typeof raw?.default_type === 'string' && raw.default_type.trim()
        ? raw.default_type.trim()
        : DEFAULTS.default_type,
    update_log: typeof raw?.update_log === 'boolean' ? raw.update_log : DEFAULTS.update_log,
  }
}

export async function GET() {
  // Reads work without a session: public repos are viewable anonymously.
  const session = await getSession()
  const config = getRepoConfig()
  if (!config) {
    return NextResponse.json({ error: 'No wiki repository configured (set GIT_REPO)' }, { status: 500 })
  }
  try {
    const file = await getFile(session?.token ?? null, config, fullPath(config, SETTINGS_FILE))
    const parsed = yaml.load(file.content)
    return NextResponse.json({ settings: sanitize(parsed), sha: file.sha, exists: true })
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      return NextResponse.json({ settings: DEFAULTS, sha: null, exists: false })
    }
    const status = err instanceof GitHubError ? err.status : 502
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status })
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const config = getRepoConfig()
  if (!config) {
    return NextResponse.json({ error: 'No wiki repository configured (set GIT_REPO)' }, { status: 500 })
  }
  const payload = await req.json().catch(() => null)
  if (!payload?.settings) return NextResponse.json({ error: 'settings object required' }, { status: 400 })
  const settings = sanitize(payload.settings)
  const sha = typeof payload.sha === 'string' && payload.sha ? payload.sha : undefined
  const content =
    '# Commonplace wiki settings — edited via the wiki UI, safe to edit by hand.\n' +
    yaml.dump(settings, { lineWidth: 120 })
  try {
    const newSha = await putFile(
      session.token,
      config,
      fullPath(config, SETTINGS_FILE),
      content,
      'Update wiki settings',
      sha
    )
    return NextResponse.json({ settings, sha: newSha })
  } catch (err) {
    if (err instanceof GitHubError && (err.status === 409 || err.status === 422)) {
      return NextResponse.json(
        { error: 'Settings changed on GitHub since you loaded them. Reload and retry.' },
        { status: 409 }
      )
    }
    const status = err instanceof GitHubError ? err.status : 502
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status })
  }
}
