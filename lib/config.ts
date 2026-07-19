/** The URL's host decides the provider; ADO etc. can be added here. */
export type RepoProvider = 'github' | 'gitlab'

export interface RepoConfig {
  provider: RepoProvider
  /** API/web host, e.g. "github.com" or a self-hosted GitLab host. */
  host: string
  /** First path segment (GitHub owner / GitLab top-level group). */
  owner: string
  /** Rest of the project path; may contain "/" for nested GitLab groups. */
  repo: string
  branch: string
  /** Optional subdirectory inside the repository that is the OKF bundle root. */
  root: string
}

/** Full project path, e.g. "owner/repo" or "group/subgroup/repo". */
export function projectPath(config: Pick<RepoConfig, 'owner' | 'repo'>): string {
  return `${config.owner}/${config.repo}`
}

/**
 * Parse a repository URL like "https://github.com/owner/repo" or
 * "https://gitlab.com/group/subgroup/repo" into a provider + project path.
 * Bare "owner/repo" is accepted as a GitHub shorthand. A non-gitlab.com
 * GitLab host can be forced with GIT_PROVIDER=gitlab.
 */
export function parseRepoUrl(
  input: string
): Pick<RepoConfig, 'provider' | 'host' | 'owner' | 'repo'> | null {
  const trimmed = input.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  if (!trimmed) return null
  if (!/^[a-z]+:\/\//i.test(trimmed)) {
    const parts = trimmed.split('/')
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null
    return { provider: 'github', host: 'github.com', owner: parts[0], repo: parts[1] }
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
    return { provider: 'github', host, owner: segments[0], repo: segments[1] }
  }
  if (host === 'gitlab.com' || process.env.GIT_PROVIDER === 'gitlab') {
    if (segments.length < 2) return null
    return { provider: 'gitlab', host, owner: segments[0], repo: segments.slice(1).join('/') }
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
