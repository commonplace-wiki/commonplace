/**
 * Browser-side cache of /api/file responses, so navigating back to a page
 * renders it immediately instead of waiting on a GitHub round-trip. Callers
 * paint the cached copy, refetch in the background, and replace it — the
 * cache is never the source of truth, only a head start.
 *
 * Every function is a no-op outside the browser (client components are also
 * prerendered on the server) and swallows storage errors: a missing or broken
 * cache degrades to the uncached behaviour, never to a failure.
 */

const PREFIX = 'okf_page:'

function store(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    // Storage access can throw outright when cookies/storage are blocked.
    return null
  }
}

export function readCachedPage<T>(path: string): T | null {
  const s = store()
  if (!s) return null
  try {
    const raw = s.getItem(PREFIX + path)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** Drop every cached page (on quota exhaustion, and on sign-out). */
export function clearCachedPages() {
  const s = store()
  if (!s) return
  try {
    for (const key of Object.keys(s)) {
      if (key.startsWith(PREFIX)) s.removeItem(key)
    }
  } catch {
    // ignore
  }
}

export function writeCachedPage(path: string, data: unknown) {
  const s = store()
  if (!s) return
  const serialized = JSON.stringify(data)
  try {
    s.setItem(PREFIX + path, serialized)
  } catch {
    // Most likely the quota: a big wiki browsed long enough fills it. Start
    // over rather than leaving a full cache that can never take new pages.
    clearCachedPages()
    try {
      s.setItem(PREFIX + path, serialized)
    } catch {
      // ignore
    }
  }
}

/**
 * Forget one page. Used after a write, where the cached copy is known stale
 * and the response does not carry everything needed to prime a fresh one.
 */
export function invalidateCachedPage(path: string) {
  const s = store()
  if (!s) return
  try {
    s.removeItem(PREFIX + path)
  } catch {
    // ignore
  }
}
