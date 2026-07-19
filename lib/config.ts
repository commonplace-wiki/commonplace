/** Only GitHub is implemented; the URL's host decides, so GitLab/ADO can be added here. */
export type RepoProvider = 'github'

export interface RepoConfig {
  provider: RepoProvider
  owner: string
  repo: string
  branch: string
  /** Optional subdirectory inside the repository that is the OKF bundle root. */
  root: string
}

/**
 * Parse a repository URL like "https://github.com/owner/repo" into a provider
 * plus owner/repo. Bare "owner/repo" is accepted as a GitHub shorthand.
 */
export function parseRepoUrl(
  input: string
): { provider: RepoProvider; owner: string; repo: string } | null {
  const trimmed = input.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  if (!trimmed) return null
  if (!/^[a-z]+:\/\//i.test(trimmed)) {
    const parts = trimmed.split('/')
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null
    return { provider: 'github', owner: parts[0], repo: parts[1] }
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const segments = url.pathname.split('/').filter(Boolean)
  if (host === 'github.com') {
    if (segments.length !== 2) return null
    return { provider: 'github', owner: segments[0], repo: segments[1] }
  }
  return null
}

/**
 * The wiki repository, configured for the whole deployment:
 * GIT_REPO="https://github.com/owner/repo" (or bare "owner/repo"),
 * optional GIT_BRANCH (default main) and GIT_ROOT.
 * Null when GIT_REPO is unset or not a supported URL.
 */
export function getRepoConfig(): RepoConfig | null {
  const raw = process.env.GIT_REPO || ''
  if (!raw) return null
  const parsed = parseRepoUrl(raw)
  if (!parsed) {
    console.warn(`GIT_REPO is set but not a supported repository URL: ${raw}`)
    return null
  }
  return {
    ...parsed,
    branch: process.env.GIT_BRANCH || 'main',
    root: (process.env.GIT_ROOT || '').replace(/^\/+|\/+$/g, ''),
  }
}

/**
 * Validate a bundle-relative path and resolve it against the configured
 * bundle root. Rejects traversal and absolute paths.
 */
export function fullPath(config: RepoConfig, bundlePath: string): string {
  const clean = bundlePath.replace(/^\/+/, '')
  if (clean === '') throw new Error('Empty path')
  const segments = clean.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error(`Invalid path: ${bundlePath}`)
  }
  return config.root ? `${config.root}/${clean}` : clean
}
