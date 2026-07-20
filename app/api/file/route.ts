import { NextRequest, NextResponse } from 'next/server'
import { fullPath, getRepoConfig, type RepoConfig } from '@/lib/config'
import {
  deleteFile,
  getFile,
  GitHubError,
  historyUrl,
  lastCommit,
  putFile,
  webUrl,
  type LastCommit,
} from '@/lib/repo'
import { updateLog } from '@/lib/log'
import {
  conceptTitle,
  isReservedName,
  parseConcept,
  serializeConcept,
  type Frontmatter,
} from '@/lib/okf'
import { getSession } from '@/lib/session'

function errorResponse(err: unknown) {
  const status = err instanceof GitHubError ? err.status : 502
  const message = err instanceof Error ? err.message : 'GitHub request failed'
  return NextResponse.json({ error: message }, { status })
}

async function requireContext() {
  const session = await getSession()
  if (!session) {
    return { error: NextResponse.json({ error: 'Not signed in' }, { status: 401 }) }
  }
  const config = getRepoConfig()
  if (!config) {
    return {
      error: NextResponse.json({ error: 'No wiki repository configured (set GIT_REPO)' }, { status: 500 }),
    }
  }
  return { session, config }
}

function validateMarkdownPath(config: RepoConfig, bundlePath: unknown): string {
  if (typeof bundlePath !== 'string' || !bundlePath.endsWith('.md')) {
    throw new Error('Path must point to a .md file')
  }
  fullPath(config, bundlePath)
  return bundlePath.replace(/^\/+/, '')
}

export async function GET(req: NextRequest) {
  // Reads work without a session: public repos are viewable anonymously.
  const session = await getSession()
  const config = getRepoConfig()
  if (!config) {
    return NextResponse.json({ error: 'No wiki repository configured (set GIT_REPO)' }, { status: 500 })
  }
  const token = session?.token ?? null
  const path = req.nextUrl.searchParams.get('path') || ''
  try {
    const bundlePath = validateMarkdownPath(config, path)
    const repoPath = fullPath(config, bundlePath)
    // Both reads start together: the footer's commit info is optional, so it
    // must not add its own round-trip on top of the content fetch. Catching
    // here (rather than at the await) also keeps a failing commit lookup from
    // rejecting unhandled when the content fetch is the one that throws.
    const headPromise: Promise<LastCommit | null> = lastCommit(token, config, repoPath).catch(
      () => null
    )
    const file = await getFile(token, config, repoPath)
    const { frontmatter, body } = parseConcept(file.content)
    const head = await headPromise

    return NextResponse.json({
      path: bundlePath,
      sha: file.sha,
      frontmatter,
      body,
      isReserved: isReservedName(bundlePath),
      htmlUrl: webUrl(config, repoPath),
      historyUrl: historyUrl(config, repoPath),
      lastCommit: head,
    })
  } catch (err) {
    if (err instanceof GitHubError) return errorResponse(err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 })
  }
}

export async function PUT(req: NextRequest) {
  const ctx = await requireContext()
  if ('error' in ctx) return ctx.error
  const { session, config } = ctx
  const payload = await req.json().catch(() => null)
  if (!payload) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  let bundlePath: string
  try {
    bundlePath = validateMarkdownPath(config, payload.path)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Bad path' }, { status: 400 })
  }

  const body = typeof payload.body === 'string' ? payload.body : ''
  const sha = typeof payload.sha === 'string' && payload.sha ? payload.sha : undefined
  const reserved = isReservedName(bundlePath)
  const frontmatter: Frontmatter | null =
    payload.frontmatter && typeof payload.frontmatter === 'object' ? payload.frontmatter : null

  let content: string
  if (reserved || frontmatter === null) {
    // Reserved files (index.md, log.md) carry no concept frontmatter.
    content = body.replace(/\s+$/, '') + '\n'
  } else {
    const type = frontmatter.type
    if (typeof type !== 'string' || !type.trim()) {
      return NextResponse.json(
        { error: 'Frontmatter "type" is required by OKF for concept documents' },
        { status: 400 }
      )
    }
    frontmatter.timestamp = new Date().toISOString()
    content = serializeConcept(frontmatter, body)
  }

  const message =
    typeof payload.message === 'string' && payload.message.trim()
      ? payload.message.trim()
      : `${sha ? 'Update' : 'Create'} ${bundlePath}`

  try {
    const newSha = await putFile(session.token, config, fullPath(config, bundlePath), content, message, sha)
    if (!reserved && payload.updateLog !== false) {
      await updateLog(
        session.token,
        config,
        sha ? 'Update' : 'Creation',
        bundlePath,
        conceptTitle(bundlePath, frontmatter)
      )
    }
    return NextResponse.json({ path: bundlePath, sha: newSha })
  } catch (err) {
    if (err instanceof GitHubError && (err.status === 409 || err.status === 422)) {
      return NextResponse.json(
        { error: 'The file changed on GitHub since you loaded it. Reload the page and reapply your edit.' },
        { status: 409 }
      )
    }
    return errorResponse(err)
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireContext()
  if ('error' in ctx) return ctx.error
  const { session, config } = ctx
  const payload = await req.json().catch(() => null)
  if (!payload) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  let bundlePath: string
  try {
    bundlePath = validateMarkdownPath(config, payload.path)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Bad path' }, { status: 400 })
  }
  const sha = typeof payload.sha === 'string' ? payload.sha : ''
  if (!sha) return NextResponse.json({ error: 'sha is required' }, { status: 400 })

  const title = typeof payload.title === 'string' && payload.title ? payload.title : bundlePath

  try {
    await deleteFile(session.token, config, fullPath(config, bundlePath), sha, `Delete ${bundlePath}`)
    if (!isReservedName(bundlePath)) {
      await updateLog(session.token, config, 'Deletion', bundlePath, title)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err)
  }
}
