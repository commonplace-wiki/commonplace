import { NextRequest, NextResponse } from 'next/server'
import { fullPath, getRepoConfig } from '@/lib/config'
import { rawResponse } from '@/lib/repo'
import { getSession } from '@/lib/session'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  json: 'application/json',
  csv: 'text/csv; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
}

/** Serve a repository asset (image, attachment) through the user's token. */
export async function GET(req: NextRequest) {
  // Reads work without a session: public repos are viewable anonymously.
  const session = await getSession()
  const config = getRepoConfig()
  if (!config) {
    return new NextResponse('No wiki repository configured (set GIT_REPO)', { status: 500 })
  }

  const path = req.nextUrl.searchParams.get('path') || ''
  let repoPath: string
  try {
    repoPath = fullPath(config, path)
  } catch {
    return new NextResponse('Bad path', { status: 400 })
  }

  const upstream = await rawResponse(session?.token ?? null, config, repoPath)
  if (!upstream.ok) {
    return new NextResponse('Not found', { status: upstream.status })
  }
  const ext = (repoPath.split('.').pop() || '').toLowerCase()
  return new NextResponse(upstream.body, {
    headers: {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=60',
    },
  })
}
