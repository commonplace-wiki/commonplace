import { projectPath, type RepoConfig } from './config'
import { gh, GitHubError } from './github'
import { gl } from './gitlab'
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

/**
 * Unlike repoExists, distinguishes "private" from "cannot tell right now":
 * anonymous requests for a private repository get 404 from both providers
 * (they hide existence), so any other failure — rate-limited shared egress
 * IPs on serverless hosts, provider outage — throws instead of quietly
 * reading as private and flipping robots.txt to Disallow-all.
 */
async function probe(config: RepoConfig): Promise<boolean> {
  try {
    if (config.provider === 'local') return await repoExists(null, config)
    if (config.provider === 'gitlab') {
      await gl(null, config, `/projects/${encodeURIComponent(projectPath(config))}`)
    } else {
      await gh(null, `/repos/${config.owner}/${config.repo}`)
    }
    return true
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return false
    throw err
  }
}

export async function anonymousReadable(config: RepoConfig): Promise<boolean> {
  if (cached && cached.expiresAt > Date.now()) return cached.readable
  try {
    const readable = await probe(config)
    cached = {
      readable,
      expiresAt: Date.now() + (readable ? READABLE_TTL_MS : UNREADABLE_TTL_MS),
    }
    return readable
  } catch {
    // Unknown: keep serving the last definite answer for a short while; with
    // no history, err on the private side (crawlers stay out).
    if (cached) cached.expiresAt = Date.now() + UNREADABLE_TTL_MS
    return cached?.readable ?? false
  }
}
