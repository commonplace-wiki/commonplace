import { NextRequest, NextResponse } from 'next/server'
import { getRepoConfig, type RepoConfig } from '@/lib/config'
import { fetchFileTexts, GitHubError, listMarkdownFiles } from '@/lib/repo'
import { conceptTitle, parseConcept } from '@/lib/okf'
import { getSession } from '@/lib/session'
import { collectResults, inSubtree, type SearchPage } from '@/lib/search'

/** Maximum number of results returned; `truncated` flags when more matched. */
const RESULT_LIMIT = 50
/** How long a repository's parsed corpus is reused across queries. */
const CACHE_TTL_MS = 30_000

interface Corpus {
  pages: SearchPage[]
  truncated: boolean
  at: number
}

const corpusCache = new Map<string, Corpus>()

/**
 * Corpus cache key. The token is reduced to a present/absent marker so a
 * corpus loaded with a session can never be served to an anonymous request
 * (which would leak a private repository's content).
 */
function cacheKey(config: RepoConfig, authenticated: boolean): string {
  return [config.provider, config.host, config.owner, config.repo, config.branch, config.root, authenticated ? 'auth' : 'anon'].join('|')
}

/** Read and parse every searchable page, reusing a recent read when possible. */
async function loadCorpus(token: string | null, config: RepoConfig): Promise<Corpus> {
  const key = cacheKey(config, token != null)
  const cached = corpusCache.get(key)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached

  const { files, truncated } = await listMarkdownFiles(token, config)
  const texts = await fetchFileTexts(
    token,
    config,
    files.map((f) => f.path)
  )
  const pages: SearchPage[] = []
  for (const file of files) {
    const base = file.path.split('/').pop() || ''
    // Reserved files carry no knowledge worth searching.
    if (base === 'log.md' || base === 'README.md') continue
    const { frontmatter, body } = parseConcept(texts[file.path] ?? '')
    const tags = Array.isArray(frontmatter?.tags) ? frontmatter.tags : []
    if (tags.some((t) => t === 'hidden')) continue
    pages.push({ path: file.path, title: conceptTitle(file.path, frontmatter), body })
  }

  const corpus: Corpus = { pages, truncated, at: Date.now() }
  corpusCache.set(key, corpus)
  return corpus
}

/**
 * Full-text search over the wiki's page content. `scope=page` limits results to
 * the page at `path` and its subpages; `scope=repo` (default) searches every
 * page. Read-only, and subject to the same access rules as reading the wiki.
 */
export async function GET(req: NextRequest) {
  const config = getRepoConfig()
  if (!config) {
    return NextResponse.json({ error: 'No wiki repository configured (set GIT_REPO)' }, { status: 500 })
  }
  const query = (req.nextUrl.searchParams.get('q') || '').trim()
  const scope = req.nextUrl.searchParams.get('scope') === 'page' ? 'page' : 'repo'
  const path = (req.nextUrl.searchParams.get('path') || '').replace(/^\/+/, '')
  // An empty query never reads the repository.
  if (!query) return NextResponse.json({ results: [], truncated: false })

  const session = await getSession()
  const token = session?.token ?? null
  try {
    const corpus = await loadCorpus(token, config)
    const pages = scope === 'page' ? corpus.pages.filter((p) => inSubtree(p.path, path)) : corpus.pages
    const { results, truncated } = collectResults(pages, query, RESULT_LIMIT)
    return NextResponse.json({ results, truncated: truncated || corpus.truncated })
  } catch (err) {
    // Anonymous access to a private (or missing) repo: ask for sign-in.
    if (!session && err instanceof GitHubError && [401, 403, 404].includes(err.status)) {
      return NextResponse.json({ error: 'Sign-in required' }, { status: 401 })
    }
    // A quota refusal is not "no results"; report it so the panel can say so.
    if (err instanceof GitHubError && err.rateLimited) {
      return NextResponse.json(
        { error: 'Rate limit reached', rateLimited: true, resetAt: err.rateLimitResetAt },
        { status: 429 }
      )
    }
    const status = err instanceof GitHubError ? err.status : 502
    const message = err instanceof Error ? err.message : 'Search failed'
    return NextResponse.json({ error: message }, { status })
  }
}
