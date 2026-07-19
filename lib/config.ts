import { cookies } from 'next/headers'

const CONFIG_COOKIE = 'okf_repo'

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
 * Deployment-pinned repository, e.g. for a hosted company wiki:
 * WIKI_REPO="https://github.com/owner/repo" (or bare "owner/repo"),
 * optional WIKI_BRANCH (default main) and WIKI_ROOT.
 * When set, it overrides any per-user cookie selection.
 */
export function envRepoConfig(): RepoConfig | null {
  const raw = process.env.WIKI_REPO || ''
  if (!raw) return null
  const parsed = parseRepoUrl(raw)
  if (!parsed) {
    console.warn(`WIKI_REPO is set but not a supported repository URL: ${raw}`)
    return null
  }
  return {
    ...parsed,
    branch: process.env.WIKI_BRANCH || 'main',
    root: (process.env.WIKI_ROOT || '').replace(/^\/+|\/+$/g, ''),
  }
}

export async function getRepoConfig(): Promise<RepoConfig | null> {
  const fixed = envRepoConfig()
  if (fixed) return fixed
  const store = await cookies()
  const raw = store.get(CONFIG_COOKIE)?.value
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed.owner !== 'string' || typeof parsed.repo !== 'string') return null
    return {
      provider: 'github',
      owner: parsed.owner,
      repo: parsed.repo,
      branch: typeof parsed.branch === 'string' && parsed.branch ? parsed.branch : 'main',
      root: typeof parsed.root === 'string' ? parsed.root.replace(/^\/+|\/+$/g, '') : '',
    }
  } catch {
    return null
  }
}

export function configCookie(config: RepoConfig) {
  return {
    name: CONFIG_COOKIE,
    value: JSON.stringify(config),
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  }
}

export function clearedConfigCookie() {
  return {
    name: CONFIG_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
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
