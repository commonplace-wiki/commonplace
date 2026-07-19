import { NextRequest, NextResponse } from 'next/server'
import { fullPath, getRepoConfig } from '@/lib/config'
import { GitHubError, putFileBase64 } from '@/lib/github'
import { getSession } from '@/lib/session'

// ~5 MB of binary payload once base64 overhead is accounted for.
const MAX_BASE64_LENGTH = 7_000_000

function sanitizeName(name: string): string {
  const base = name.split(/[/\\]/).pop() || 'file'
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^\.+/, '')
  return cleaned || 'file'
}

/**
 * Upload an asset (image, attachment) into the bundle. Files land in an
 * assets/ folder next to the page they were dropped on.
 */
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const config = await getRepoConfig()
  if (!config) return NextResponse.json({ error: 'No repository selected' }, { status: 400 })

  const payload = await req.json().catch(() => null)
  const content = typeof payload?.content === 'string' ? payload.content.replace(/\s/g, '') : ''
  if (!content) return NextResponse.json({ error: 'content (base64) is required' }, { status: 400 })
  if (content.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: 'File is too large (5 MB max)' }, { status: 413 })
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(content)) {
    return NextResponse.json({ error: 'content must be base64' }, { status: 400 })
  }

  const dir = typeof payload?.dir === 'string' ? payload.dir.replace(/^\/+|\/+$/g, '') : ''
  const name = sanitizeName(typeof payload?.name === 'string' ? payload.name : 'file')
  // On a name collision, retry once with a timestamp suffix before the extension.
  const suffixed = name.replace(/(\.[^.]*)?$/, (ext) => `-${Date.now()}${ext}`)

  for (const candidate of [name, suffixed]) {
    const bundlePath = [dir, 'assets', candidate].filter(Boolean).join('/')
    let repoPath: string
    try {
      repoPath = fullPath(config, bundlePath)
    } catch {
      return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 })
    }
    try {
      await putFileBase64(session.token, config, repoPath, content, `Upload ${bundlePath}`)
      return NextResponse.json({ path: bundlePath })
    } catch (err) {
      if (err instanceof GitHubError && err.status === 422) continue
      const status = err instanceof GitHubError ? err.status : 502
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Upload failed' },
        { status }
      )
    }
  }
  return NextResponse.json({ error: 'A file with this name already exists' }, { status: 409 })
}
