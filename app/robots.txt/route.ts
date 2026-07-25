import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { getRepoConfig } from '@/lib/config'
import { publicUrl } from '@/lib/url'
import { anonymousReadable } from '@/lib/visibility'

/**
 * robots.txt, branched on repository visibility. A private wiki serves
 * "Disallow: /" so crawlers don't index the login page or hammer the auth
 * redirect; a public wiki invites indexing of the pages but keeps crawlers
 * out of the app surface (API, editor, legacy redirects).
 *
 * The "$" exact-match suffix is understood by the major crawlers and keeps
 * wiki content like /settings.md or /login.md crawlable; crawlers that treat
 * it literally simply ignore those lines, which fails open.
 */
export async function GET(req: NextRequest) {
  const config = getRepoConfig()
  const lines =
    config && (await anonymousReadable(config))
      ? [
          'User-agent: *',
          'Disallow: /api/',
          'Disallow: /edit/',
          'Disallow: /wiki/',
          'Disallow: /login$',
          'Disallow: /setup$',
          'Disallow: /graph$',
          'Disallow: /settings$',
          '',
          `Sitemap: ${publicUrl('/sitemap.xml', req)}`,
        ]
      : ['User-agent: *', 'Disallow: /']
  return new NextResponse(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
