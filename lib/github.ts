import type { RepoConfig } from './config'

const API = 'https://api.github.com'

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

/** token=null sends unauthenticated requests (public-repo viewer mode). */
export async function gh(token: string | null, path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    let message = `GitHub API error ${res.status}`
    try {
      const data = await res.json()
      if (data?.message) message = data.message
    } catch {
      // keep generic message
    }
    throw new GitHubError(res.status, message)
  }
  if (res.status === 204) return null
  return res.json()
}

export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function contentsUrl(config: RepoConfig, repoPath: string): string {
  return `/repos/${config.owner}/${config.repo}/contents/${encodePath(repoPath)}`
}

export interface RepoFile {
  content: string
  sha: string
}

/** Fetch a file's decoded content and blob sha via the Contents API. */
export async function getFile(token: string | null, config: RepoConfig, repoPath: string): Promise<RepoFile> {
  const data = await gh(token, `${contentsUrl(config, repoPath)}?ref=${encodeURIComponent(config.branch)}`)
  if (Array.isArray(data)) throw new GitHubError(400, `${repoPath} is a directory, not a file`)
  if (data.type !== 'file') throw new GitHubError(400, `${repoPath} is not a regular file`)
  return {
    content: Buffer.from(data.content, 'base64').toString('utf8'),
    sha: data.sha,
  }
}

/** Create or update a file. Pass sha only when updating. Returns the new blob sha. */
export async function putFile(
  token: string,
  config: RepoConfig,
  repoPath: string,
  content: string,
  message: string,
  sha?: string
): Promise<string> {
  const data = await gh(token, contentsUrl(config, repoPath), {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: config.branch,
      ...(sha ? { sha } : {}),
    }),
  })
  return data.content.sha
}

/**
 * Create a binary file from already-base64-encoded content. Without sha it
 * fails if the path exists; with sha it overwrites that version.
 */
export async function putFileBase64(
  token: string,
  config: RepoConfig,
  repoPath: string,
  base64Content: string,
  message: string,
  sha?: string
): Promise<string> {
  const data = await gh(token, contentsUrl(config, repoPath), {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: base64Content,
      branch: config.branch,
      ...(sha ? { sha } : {}),
    }),
  })
  return data.content.sha
}

export async function deleteFile(
  token: string,
  config: RepoConfig,
  repoPath: string,
  sha: string,
  message: string
): Promise<void> {
  await gh(token, contentsUrl(config, repoPath), {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch: config.branch }),
  })
}

export interface TreeEntry {
  /** Path relative to the bundle root. */
  path: string
}

export interface PathMove {
  from: string
  to: string
}

/** Batch-fetch raw text of repo files (by repo path) via the GraphQL API. */
async function fetchBlobTexts(
  token: string,
  config: RepoConfig,
  repoPaths: string[]
): Promise<Record<string, string>> {
  const texts: Record<string, string> = {}
  const chunkSize = 50
  for (let i = 0; i < repoPaths.length; i += chunkSize) {
    const chunk = repoPaths.slice(i, i + chunkSize)
    const fields = chunk
      .map((p, j) => `f${j}: object(expression: ${JSON.stringify(`${config.branch}:${p}`)}) { ... on Blob { text } }`)
      .join('\n')
    const query = `query { repository(owner: ${JSON.stringify(config.owner)}, name: ${JSON.stringify(config.repo)}) { ${fields} } }`
    try {
      const data = await gh(token, '/graphql', { method: 'POST', body: JSON.stringify({ query }) })
      const repo = data?.data?.repository
      if (!repo) continue
      chunk.forEach((p, j) => {
        const text: string | undefined | null = repo[`f${j}`]?.text
        if (typeof text === 'string') texts[p] = text
      })
    } catch {
      // Missing entries fall back to per-blob fetches.
    }
  }
  return texts
}

/**
 * Move files (and whole subtrees) within the repository in a single commit,
 * using the Git Data API. Blob SHAs are reused, so no content is re-uploaded.
 * Returns the number of files moved.
 */
export async function movePaths(
  token: string,
  config: RepoConfig,
  moves: PathMove[],
  message: string,
  /** Optional content rewrite for moved markdown files (e.g. fixing self-referential links). */
  contentRewrite?: (path: string, content: string) => string
): Promise<number> {
  const repoBase = `/repos/${config.owner}/${config.repo}`
  const ref = await gh(token, `${repoBase}/git/ref/heads/${encodeURIComponent(config.branch)}`)
  const baseCommitSha = ref.object.sha
  const baseCommit = await gh(token, `${repoBase}/git/commits/${baseCommitSha}`)
  const tree = await gh(token, `${repoBase}/git/trees/${baseCommit.tree.sha}?recursive=1`)
  if (tree.truncated) {
    throw new GitHubError(413, 'Repository tree is too large for a safe move')
  }

  const blobs = (tree.tree as any[]).filter((t) => t.type === 'blob')
  const existing = new Set(blobs.map((t) => t.path))
  const entries: { path: string; mode: string; type: 'blob'; sha: string | null }[] = []
  let moved = 0

  // Links are rewritten in EVERY markdown file, not just the moved ones, so
  // inbound links from other pages follow the move. Batch-fetch the texts.
  let texts: Record<string, string> = {}
  if (contentRewrite) {
    texts = await fetchBlobTexts(
      token,
      config,
      blobs.filter((b) => b.path.endsWith('.md')).map((b) => b.path)
    )
  }

  async function rewrittenSha(path: string, sha: string): Promise<{ sha: string; changed: boolean }> {
    if (!contentRewrite || !path.endsWith('.md')) return { sha, changed: false }
    let text = texts[path]
    if (text === undefined) {
      const blob = await gh(token, `${repoBase}/git/blobs/${sha}`)
      text = Buffer.from(blob.content, 'base64').toString('utf8')
    }
    const rewritten = contentRewrite(path, text)
    if (rewritten === text) return { sha, changed: false }
    const created = await gh(token, `${repoBase}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({
        content: Buffer.from(rewritten, 'utf8').toString('base64'),
        encoding: 'base64',
      }),
    })
    return { sha: created.sha, changed: true }
  }

  for (const item of blobs) {
    const move = moves.find((m) => item.path === m.from || item.path.startsWith(`${m.from}/`))
    if (move) {
      const newPath = move.to + item.path.slice(move.from.length)
      if (existing.has(newPath)) {
        throw new GitHubError(409, `${newPath} already exists`)
      }
      const { sha } = await rewrittenSha(item.path, item.sha)
      entries.push({ path: newPath, mode: item.mode, type: 'blob', sha })
      entries.push({ path: item.path, mode: item.mode, type: 'blob', sha: null })
      moved++
    } else {
      const { sha, changed } = await rewrittenSha(item.path, item.sha)
      if (changed) entries.push({ path: item.path, mode: item.mode, type: 'blob', sha })
    }
  }
  if (moved === 0) {
    throw new GitHubError(404, 'Nothing to move')
  }

  const newTree = await gh(token, `${repoBase}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: entries }),
  })
  const newCommit = await gh(token, `${repoBase}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: newTree.sha, parents: [baseCommitSha] }),
  })
  await gh(token, `${repoBase}/git/refs/heads/${encodeURIComponent(config.branch)}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: newCommit.sha }),
  })
  return moved
}

export interface FileMeta {
  title: string | null
  /** True when the frontmatter tags include "hidden": excluded from navigation. */
  hidden: boolean
}

export interface LastCommit {
  date: string
  name: string
  login: string | null
  avatarUrl: string | null
  authorUrl: string | null
}

/** Who last touched a file (best effort, for the page footer). */
export async function lastCommit(
  token: string | null,
  config: RepoConfig,
  repoPath: string
): Promise<LastCommit | null> {
  const commits = await gh(
    token,
    `/repos/${config.owner}/${config.repo}/commits?path=${encodeURIComponent(repoPath)}&sha=${encodeURIComponent(config.branch)}&per_page=1`
  )
  const head = Array.isArray(commits) ? commits[0] : null
  if (!head) return null
  return {
    date: head.commit?.author?.date || head.commit?.committer?.date || '',
    name: head.commit?.author?.name || head.author?.login || 'unknown',
    login: head.author?.login || null,
    avatarUrl: head.author?.avatar_url || null,
    authorUrl: head.author?.login ? `https://github.com/${head.author.login}` : null,
  }
}

/**
 * For GitHub App user tokens, /repos/{owner}/{repo} reports the USER's
 * permission, not the token's — /user/installations answers which repos the
 * app token can actually reach.
 */
async function appInstalledOnRepo(token: string, config: RepoConfig): Promise<boolean | null> {
  try {
    const data = await gh(token, '/user/installations?per_page=50')
    const fullName = `${config.owner}/${config.repo}`.toLowerCase()
    for (const inst of data?.installations || []) {
      for (let page = 1; page <= 10; page++) {
        const repos = await gh(
          token,
          `/user/installations/${inst.id}/repositories?per_page=100&page=${page}`
        )
        const list: { full_name?: string }[] = repos?.repositories || []
        if (list.some((r) => (r.full_name || '').toLowerCase() === fullName)) return true
        if (list.length < 100) break
      }
    }
    return false
  } catch {
    return null
  }
}

/** Effective write access of this token to the wiki repo. Null = undetermined. */
export async function canWrite(
  token: string,
  config: RepoConfig,
  authMethod: string
): Promise<boolean | null> {
  let can: boolean
  try {
    const repo = await gh(token, `/repos/${config.owner}/${config.repo}`)
    can = Boolean(repo?.permissions?.push)
  } catch {
    return false
  }
  if (can && authMethod === 'github-app') {
    const installed = await appInstalledOnRepo(token, config)
    if (installed === false) can = false
  }
  return can
}

/** Whether the repository itself is reachable (used to detect empty repos). */
export async function repoExists(token: string | null, config: RepoConfig): Promise<boolean> {
  try {
    await gh(token, `/repos/${config.owner}/${config.repo}`)
    return true
  } catch {
    return false
  }
}

/** Stream a repository file (image, attachment) as a fetch Response. */
export async function rawResponse(
  token: string | null,
  config: RepoConfig,
  repoPath: string
): Promise<Response> {
  return fetch(
    `${API}/repos/${config.owner}/${config.repo}/contents/${encodePath(repoPath)}?ref=${encodeURIComponent(config.branch)}`,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      cache: 'no-store',
    }
  )
}

/** Validate a token and return its user (for PAT sign-in). */
export async function userInfo(token: string): Promise<{ login: string; avatarUrl: string }> {
  const user = await gh(token, '/user')
  return { login: user.login, avatarUrl: user.avatar_url }
}

/** A person who can be @-mentioned: someone with access to the wiki repository. */
export interface MentionUser {
  login: string
  name: string | null
  avatarUrl: string
  profileUrl: string
}

function toMentionUser(u: any): MentionUser | null {
  if (!u?.login) return null
  return {
    login: u.login,
    // Neither the collaborators nor the members payload carries a display name.
    name: null,
    avatarUrl: u.avatar_url || '',
    profileUrl: u.html_url || `https://github.com/${u.login}`,
  }
}

/**
 * Page through a user-listing endpoint. Three pages is far more than a mention
 * list needs; it caps the work on very large repositories and organizations.
 */
async function listUsers(token: string, path: string): Promise<MentionUser[]> {
  const users: MentionUser[] = []
  for (let page = 1; page <= 3; page++) {
    const batch = await gh(token, `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
    if (!Array.isArray(batch)) break
    for (const entry of batch) {
      const user = toMentionUser(entry)
      if (user) users.push(user)
    }
    if (batch.length < 100) break
  }
  return users
}

/**
 * People who can be @-mentioned: repository collaborators, plus the wider
 * organization membership when the token is allowed to see it.
 *
 * Collaborators already covers outside collaborators and the organization
 * members who have access to this repository. Organization members are a
 * separate call because it needs the "Members" organization permission (read),
 * which a GitHub App only has if it was granted; without it GitHub answers 403
 * and we fall back to collaborators alone rather than failing the request.
 */
export async function listCollaborators(token: string, config: RepoConfig): Promise<MentionUser[]> {
  const collaborators = await listUsers(
    token,
    `/repos/${config.owner}/${config.repo}/collaborators?affiliation=all`
  )
  let members: MentionUser[] = []
  try {
    members = await listUsers(token, `/orgs/${config.owner}/members`)
  } catch (err) {
    // 403: the token lacks Members (read). 404: the owner is a user account,
    // not an organization, so there is no membership to read.
    if (!(err instanceof GitHubError && (err.status === 403 || err.status === 404))) throw err
  }
  const byLogin = new Map<string, MentionUser>()
  for (const user of [...collaborators, ...members]) {
    if (!byLogin.has(user.login)) byLogin.set(user.login, user)
  }
  return [...byLogin.values()]
}

export function webUrl(config: RepoConfig, repoPath: string): string {
  return `https://github.com/${config.owner}/${config.repo}/blob/${config.branch}/${repoPath}`
}

export function historyUrl(config: RepoConfig, repoPath: string): string {
  return `https://github.com/${config.owner}/${config.repo}/commits/${config.branch}/${repoPath}`
}

export function repoHomeUrl(config: RepoConfig): string {
  return `https://github.com/${config.owner}/${config.repo}`
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function extractMeta(text: string): FileMeta {
  if (!text.startsWith('---')) return { title: null, hidden: false }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { title: null, hidden: false }
  const fm = text.slice(0, end)

  const titleMatch = fm.match(/^title:\s*(.+)$/m)
  const title = titleMatch ? unquote(titleMatch[1]) || null : null

  // tags may be inline (`tags: [a, b]`) or a block list (`tags:\n  - a`).
  const tags: string[] = []
  const tagsMatch = fm.match(/^tags:[ \t]*(.*)((?:\n[ \t]+-[ \t]+.*)*)/m)
  if (tagsMatch) {
    const inline = tagsMatch[1].trim()
    if (inline.startsWith('[')) {
      tags.push(...inline.replace(/^\[|\]$/g, '').split(','))
    }
    if (tagsMatch[2]) {
      for (const line of tagsMatch[2].split('\n')) {
        tags.push(line.replace(/^[ \t]+-[ \t]+/, ''))
      }
    }
  }
  const hidden = tags.some((t) => unquote(t) === 'hidden')
  return { title, hidden }
}

/** Batch-fetch frontmatter metadata for markdown files via the GraphQL API. */
export async function fetchFileMeta(
  token: string | null,
  config: RepoConfig,
  paths: string[]
): Promise<Record<string, FileMeta>> {
  const meta: Record<string, FileMeta> = {}
  // The GraphQL API requires authentication; anonymous viewers of public
  // repos get the frontmatter from the raw CDN instead.
  if (!token) {
    const prefix = config.root ? `${config.root}/` : ''
    const chunkSize = 25
    for (let i = 0; i < paths.length; i += chunkSize) {
      await Promise.all(
        paths.slice(i, i + chunkSize).map(async (p) => {
          try {
            const res = await fetch(
              `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/${encodePath(prefix + p)}`,
              { cache: 'no-store' }
            )
            if (res.ok) meta[p] = extractMeta(await res.text())
          } catch {
            // Metadata is cosmetic; the sidebar falls back to filenames.
          }
        })
      )
    }
    return meta
  }
  const chunkSize = 50
  for (let i = 0; i < paths.length; i += chunkSize) {
    const chunk = paths.slice(i, i + chunkSize)
    const fields = chunk
      .map((p, j) => {
        const expression = `${config.branch}:${config.root ? `${config.root}/` : ''}${p}`
        return `f${j}: object(expression: ${JSON.stringify(expression)}) { ... on Blob { text } }`
      })
      .join('\n')
    const query = `query { repository(owner: ${JSON.stringify(config.owner)}, name: ${JSON.stringify(config.repo)}) { ${fields} } }`
    try {
      const data = await gh(token, '/graphql', { method: 'POST', body: JSON.stringify({ query }) })
      const repo = data?.data?.repository
      if (!repo) continue
      chunk.forEach((p, j) => {
        const text: string | undefined = repo[`f${j}`]?.text
        if (text) meta[p] = extractMeta(text)
      })
    } catch {
      // Metadata is cosmetic; the sidebar falls back to filenames.
    }
  }
  return meta
}

/**
 * Batch-fetch the raw text of bundle files. Authenticated requests use the
 * GraphQL API; anonymous ones (public repos) fall back to the raw CDN.
 */
export async function fetchFileTexts(
  token: string | null,
  config: RepoConfig,
  bundlePaths: string[]
): Promise<Record<string, string>> {
  const texts: Record<string, string> = {}
  const prefix = config.root ? `${config.root}/` : ''
  if (!token) {
    const chunkSize = 25
    for (let i = 0; i < bundlePaths.length; i += chunkSize) {
      await Promise.all(
        bundlePaths.slice(i, i + chunkSize).map(async (p) => {
          try {
            const res = await fetch(
              `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${encodeURIComponent(config.branch)}/${encodePath(prefix + p)}`,
              { cache: 'no-store' }
            )
            if (res.ok) texts[p] = await res.text()
          } catch {
            // missing entries are simply absent from the result
          }
        })
      )
    }
    return texts
  }
  const chunkSize = 50
  for (let i = 0; i < bundlePaths.length; i += chunkSize) {
    const chunk = bundlePaths.slice(i, i + chunkSize)
    const fields = chunk
      .map((p, j) => {
        const expression = `${config.branch}:${prefix}${p}`
        return `f${j}: object(expression: ${JSON.stringify(expression)}) { ... on Blob { text } }`
      })
      .join('\n')
    const query = `query { repository(owner: ${JSON.stringify(config.owner)}, name: ${JSON.stringify(config.repo)}) { ${fields} } }`
    try {
      const data = await gh(token, '/graphql', { method: 'POST', body: JSON.stringify({ query }) })
      const repo = data?.data?.repository
      if (!repo) continue
      chunk.forEach((p, j) => {
        const text: string | undefined | null = repo[`f${j}`]?.text
        if (typeof text === 'string') texts[p] = text
      })
    } catch {
      // missing entries are simply absent from the result
    }
  }
  return texts
}

/**
 * List every markdown file below the configured bundle root, and detect an
 * optional wiki logo (logo.svg preferred over logo.png) at the bundle root.
 */
export async function listMarkdownFiles(
  token: string | null,
  config: RepoConfig
): Promise<{ files: TreeEntry[]; truncated: boolean; logo: string | null }> {
  const data = await gh(
    token,
    `/repos/${config.owner}/${config.repo}/git/trees/${encodeURIComponent(config.branch)}?recursive=1`
  )
  const prefix = config.root ? `${config.root}/` : ''
  const files: TreeEntry[] = []
  const bundlePaths = new Set<string>()
  for (const entry of data.tree || []) {
    if (entry.type !== 'blob') continue
    if (prefix && !entry.path.startsWith(prefix)) continue
    const bundlePath = entry.path.slice(prefix.length)
    bundlePaths.add(bundlePath)
    if (bundlePath.startsWith('.commonplace/')) continue
    if (bundlePath.endsWith('.md')) files.push({ path: bundlePath })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  const logo = bundlePaths.has('.commonplace/logo.svg')
    ? '.commonplace/logo.svg'
    : bundlePaths.has('.commonplace/logo.png')
      ? '.commonplace/logo.png'
      : null
  return { files, truncated: Boolean(data.truncated), logo }
}
