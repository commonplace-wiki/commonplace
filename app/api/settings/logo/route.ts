import { NextRequest, NextResponse } from 'next/server'
import { fullPath, getRepoConfig } from '@/lib/config'
import { deleteFile, encodePath, getFile, gh, GitHubError } from '@/lib/github'
import { getSession } from '@/lib/session'

// ~1 MB of binary payload once base64 overhead is accounted for.
const MAX_BASE64_LENGTH = 1_400_000

const EXTENSIONS = ['svg', 'png'] as const
type LogoExt = (typeof EXTENSIONS)[number]

function logoPath(ext: LogoExt): string {
  return `.commonplace/logo.${ext}`
}

async function existingSha(token: string, config: NonNullable<ReturnType<typeof getRepoConfig>>, bundlePath: string) {
  try {
    return (await getFile(token, config, fullPath(config, bundlePath))).sha
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null
    throw err
  }
}

/** Upload the wiki logo: committed as .commonplace/logo.svg or .png. */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const config = getRepoConfig()
  if (!config) {
    return NextResponse.json({ error: 'No wiki repository configured (set GIT_REPO)' }, { status: 500 })
  }

  const payload = await req.json().catch(() => null)
  const ext = payload?.ext as LogoExt
  if (!EXTENSIONS.includes(ext)) {
    return NextResponse.json({ error: 'ext must be "svg" or "png"' }, { status: 400 })
  }
  const content = typeof payload?.content === 'string' ? payload.content.replace(/\s/g, '') : ''
  if (!content || !/^[A-Za-z0-9+/]+=*$/.test(content)) {
    return NextResponse.json({ error: 'content (base64) is required' }, { status: 400 })
  }
  if (content.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: 'Logo is too large (1 MB max)' }, { status: 413 })
  }

  try {
    const bundlePath = logoPath(ext)
    const sha = await existingSha(session.token, config, bundlePath)
    await gh(session.token, `/repos/${config.owner}/${config.repo}/contents/${encodePath(fullPath(config, bundlePath))}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Update wiki logo',
        content,
        branch: config.branch,
        ...(sha ? { sha } : {}),
      }),
    })
    // Keep a single logo: drop the other format if it exists.
    const other = logoPath(ext === 'svg' ? 'png' : 'svg')
    const otherSha = await existingSha(session.token, config, other)
    if (otherSha) {
      await deleteFile(session.token, config, fullPath(config, other), otherSha, 'Remove old wiki logo')
    }
    return NextResponse.json({ path: bundlePath })
  } catch (err) {
    const status = err instanceof GitHubError ? err.status : 502
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status })
  }
}

/** Remove the wiki logo (whichever format exists). */
export async function DELETE() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const config = getRepoConfig()
  if (!config) {
    return NextResponse.json({ error: 'No wiki repository configured (set GIT_REPO)' }, { status: 500 })
  }
  try {
    for (const ext of EXTENSIONS) {
      const bundlePath = logoPath(ext)
      const sha = await existingSha(session.token, config, bundlePath)
      if (sha) await deleteFile(session.token, config, fullPath(config, bundlePath), sha, 'Remove wiki logo')
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const status = err instanceof GitHubError ? err.status : 502
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Delete failed' }, { status })
  }
}
