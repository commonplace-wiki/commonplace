import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getRepoConfig } from '@/lib/config'
import { fetchFileMeta, listMarkdownFiles } from '@/lib/repo'
import { publicOrigin } from '@/lib/url'
import { anonymousReadable } from '@/lib/visibility'

/**
 * Sitemap for anonymously readable wikis. A private wiki answers 404: a
 * sitemap would enumerate the page structure to anyone who asks, and
 * robots.txt already disallows crawling entirely.
 *
 * index.md renders at its directory's URL, so it is listed under that URL;
 * log.md (the OKF update log) and pages tagged "hidden" are left out, same
 * as in the navigation.
 */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Never prerender: a build-time render would bake the build machine's view
// of the repository's visibility into a static response for good.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const config = getRepoConfig()
  if (!config || !(await anonymousReadable(config))) {
    // Cached briefly so a transient wrong answer cannot stick at a CDN edge.
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  }
  try {
    const { files } = await listMarkdownFiles(null, config)
    const meta = await fetchFileMeta(
      null,
      config,
      files.map((f) => f.path)
    )
    const paths = new Set<string>(['/'])
    for (const f of files) {
      if (meta[f.path]?.hidden) continue
      const base = f.path.split('/').pop()
      if (base === 'log.md') continue
      if (base === 'index.md') {
        const dir = f.path.slice(0, -'/index.md'.length)
        paths.add(f.path === 'index.md' ? '/' : `/${dir}`)
      } else {
        paths.add(`/${f.path}`)
      }
    }
    const origin = publicOrigin(req)
    const urls = [...paths]
      .sort()
      .map((p) => `  <url><loc>${xmlEscape(origin + encodeURI(p))}</loc></url>`)
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.join('\n') +
      '\n</urlset>\n'
    return new NextResponse(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    // Transient listing failure: tell crawlers to retry rather than serving
    // an empty sitemap that would deindex everything.
    return new NextResponse('Sitemap temporarily unavailable', { status: 503 })
  }
}
