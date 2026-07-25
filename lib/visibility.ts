import type { RepoConfig } from './config'
import { repoExists } from './repo'

/**
 * Whether the wiki is readable without signing in (public repository, or a
 * local repository). Decides what crawlers get: robots.txt allows indexing
 * and the sitemap exists only for anonymously readable wikis.
 *
 * Cached because robots.txt is fetched by every crawler on every visit and
 * the answer costs a provider API call. Denials expire sooner so a repo that
 * just went public is picked up quickly.
 */

const READABLE_TTL_MS = 5 * 60_000
const UNREADABLE_TTL_MS = 30_000

let cached: { readable: boolean; expiresAt: number } | null = null

export async function anonymousReadable(config: RepoConfig): Promise<boolean> {
  if (cached && cached.expiresAt > Date.now()) return cached.readable
  const readable = await repoExists(null, config).catch(() => false)
  cached = {
    readable,
    expiresAt: Date.now() + (readable ? READABLE_TTL_MS : UNREADABLE_TTL_MS),
  }
  return readable
}
