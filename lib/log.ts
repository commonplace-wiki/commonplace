import { fullPath, type RepoConfig } from './config'
import { getFile, GitHubError, putFile } from './repo'
import { appendLogEntry, type LogAction } from './okf'

/**
 * Best-effort maintenance of the bundle-root log.md per OKF spec section 7.
 * Log failures never fail the main operation.
 */
export async function updateLog(
  token: string,
  config: RepoConfig,
  action: LogAction,
  bundlePath: string,
  title: string
) {
  try {
    const logRepoPath = fullPath(config, 'log.md')
    let existing: string | null = null
    let sha: string | undefined
    try {
      const file = await getFile(token, config, logRepoPath)
      existing = file.content
      sha = file.sha
    } catch (err) {
      if (!(err instanceof GitHubError && err.status === 404)) throw err
    }
    const today = new Date().toISOString().slice(0, 10)
    const updated = appendLogEntry(existing, action, bundlePath, title, today)
    await putFile(token, config, logRepoPath, updated, `Log ${action.toLowerCase()} of ${bundlePath}`, sha)
  } catch {
    // best effort only
  }
}
