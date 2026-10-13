/**
 * Pure helpers for wiki content search: matching, snippet extraction, subtree
 * scoping, and result assembly. No I/O here, so these are unit-testable without
 * a repository; `app/api/search/route.ts` supplies the pages.
 */

export interface SearchPage {
  path: string
  title: string
  body: string
}

export interface SearchResult {
  path: string
  title: string
  snippet: string
}

/** Case-insensitive substring match. */
export function matches(query: string, text: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase())
}

/** A single-line snippet around the first match of `query`, with ellipses. */
export function makeSnippet(body: string, query: string, radius = 60): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  const idx = flat.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return flat.slice(0, radius * 2)
  const start = Math.max(0, idx - radius)
  const end = Math.min(flat.length, idx + query.length + radius)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

/**
 * True when `filePath` is the page at `pagePath` or a page beneath it. A page
 * path may be a `.md` file or a directory (its Confluence-style twin page
 * belongs to the same subtree). An empty `pagePath` matches everything (the
 * repository root).
 */
export function inSubtree(filePath: string, pagePath: string): boolean {
  if (!pagePath) return true
  const base = pagePath.endsWith('.md') ? pagePath.slice(0, -3) : pagePath
  return filePath === pagePath || filePath === `${base}.md` || filePath.startsWith(`${base}/`)
}

/** Bounded, ordered results: pages whose body matches, with a snippet each. */
export function collectResults(
  pages: SearchPage[],
  query: string,
  limit: number
): { results: SearchResult[]; truncated: boolean } {
  const results: SearchResult[] = []
  let matched = 0
  for (const page of pages) {
    if (!matches(query, page.body)) continue
    matched++
    if (results.length < limit) {
      results.push({ path: page.path, title: page.title, snippet: makeSnippet(page.body, query) })
    }
  }
  return { results, truncated: matched > limit }
}
