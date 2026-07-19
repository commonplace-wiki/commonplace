import { projectPath, type RepoConfig } from './config'
import {
  extractMeta,
  GitHubError,
  type FileMeta,
  type LastCommit,
  type PathMove,
  type RepoFile,
  type TreeEntry,
} from './github'

/**
 * GitLab implementation of the repository provider (REST v4 + GraphQL).
 * The `sha` handed to callers is the file's last_commit_id, which GitLab
 * uses for conflict detection on updates and deletes.
 */

function apiBase(config: RepoConfig): string {
  return `https://${config.host}/api/v4`
}

function projectId(config: RepoConfig): string {
  return encodeURIComponent(projectPath(config))
}

/** token=null sends unauthenticated requests (public-project viewer mode). */
export async function gl(
  token: string | null,
  config: RepoConfig,
  path: string,
  init: RequestInit = {}
): Promise<any> {
  const res = await fetch(`${apiBase(config)}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
    cache: 'no-store',
  })
  if (!res.ok) {
    let message = `GitLab API error ${res.status}`
    try {
      const data = await res.json()
      const detail = data?.message ?? data?.error
      if (typeof detail === 'string') message = detail
      else if (detail) message = JSON.stringify(detail)
    } catch {
      // keep generic message
    }
    // GitLab reports a stale last_commit_id as 400; normalize to 409 so the
    // routes' concurrent-edit handling applies.
    const status = res.status === 400 && /changed since|does not match/i.test(message) ? 409 : res.status
    throw new GitHubError(status, message)
  }
  if (res.status === 204) return null
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

function filesUrl(config: RepoConfig, repoPath: string): string {
  return `/projects/${projectId(config)}/repository/files/${encodeURIComponent(repoPath)}`
}

export async function getFile(
  token: string | null,
  config: RepoConfig,
  repoPath: string
): Promise<RepoFile> {
  const data = await gl(token, config, `${filesUrl(config, repoPath)}?ref=${encodeURIComponent(config.branch)}`)
  return {
    content: Buffer.from(data.content, 'base64').toString('utf8'),
    sha: data.last_commit_id,
  }
}

async function currentSha(token: string, config: RepoConfig, repoPath: string): Promise<string> {
  const data = await gl(
    token,
    config,
    `${filesUrl(config, repoPath)}?ref=${encodeURIComponent(config.branch)}`
  )
  return data.last_commit_id
}

/** Create or update a file. Pass sha (last_commit_id) only when updating. */
export async function putFile(
  token: string,
  config: RepoConfig,
  repoPath: string,
  content: string,
  message: string,
  sha?: string
): Promise<string> {
  const body = JSON.stringify({
    branch: config.branch,
    content,
    commit_message: message,
    ...(sha ? { last_commit_id: sha } : {}),
  })
  try {
    await gl(token, config, filesUrl(config, repoPath), { method: sha ? 'PUT' : 'POST', body })
  } catch (err) {
    // Creating a file that already exists: normalize to 422 like GitHub.
    if (!sha && err instanceof GitHubError && err.status === 400 && /exists/i.test(err.message)) {
      throw new GitHubError(422, err.message)
    }
    throw err
  }
  // The files API does not return the new commit id; fetch it for the caller.
  return currentSha(token, config, repoPath)
}

/**
 * Create a binary file from base64 content. Without sha it fails if the path
 * exists; with sha it overwrites that version.
 */
export async function putFileBase64(
  token: string,
  config: RepoConfig,
  repoPath: string,
  base64Content: string,
  message: string,
  sha?: string
): Promise<string> {
  try {
    await gl(token, config, filesUrl(config, repoPath), {
      method: sha ? 'PUT' : 'POST',
      body: JSON.stringify({
        branch: config.branch,
        content: base64Content,
        encoding: 'base64',
        commit_message: message,
        ...(sha ? { last_commit_id: sha } : {}),
      }),
    })
  } catch (err) {
    if (!sha && err instanceof GitHubError && err.status === 400 && /exists/i.test(err.message)) {
      throw new GitHubError(422, err.message)
    }
    throw err
  }
  return currentSha(token, config, repoPath)
}

export async function deleteFile(
  token: string,
  config: RepoConfig,
  repoPath: string,
  sha: string,
  message: string
): Promise<void> {
  await gl(token, config, filesUrl(config, repoPath), {
    method: 'DELETE',
    body: JSON.stringify({
      branch: config.branch,
      commit_message: message,
      ...(sha ? { last_commit_id: sha } : {}),
    }),
  })
}

/** All blob paths in the repository (paginated recursive tree). */
async function listTree(
  token: string | null,
  config: RepoConfig
): Promise<{ paths: string[]; truncated: boolean }> {
  const paths: string[] = []
  let page: string | null = '1'
  let truncated = false
  for (let i = 0; i < 100 && page; i++) {
    const res: Response = await fetch(
      `${apiBase(config)}/projects/${projectId(config)}/repository/tree?ref=${encodeURIComponent(config.branch)}&recursive=true&per_page=100&page=${page}`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      }
    )
    if (!res.ok) {
      let message = `GitLab API error ${res.status}`
      try {
        const data = await res.json()
        if (typeof data?.message === 'string') message = data.message
      } catch {
        // keep generic
      }
      throw new GitHubError(res.status, message)
    }
    const entries: { path: string; type: string }[] = await res.json()
    for (const entry of entries) {
      if (entry.type === 'blob') paths.push(entry.path)
    }
    page = res.headers.get('x-next-page') || null
    if (i === 99 && page) truncated = true
  }
  return { paths, truncated }
}

/**
 * List every markdown file below the configured bundle root, and detect an
 * optional wiki logo at the bundle root.
 */
export async function listMarkdownFiles(
  token: string | null,
  config: RepoConfig
): Promise<{ files: TreeEntry[]; truncated: boolean; logo: string | null }> {
  const { paths, truncated } = await listTree(token, config)
  const prefix = config.root ? `${config.root}/` : ''
  const files: TreeEntry[] = []
  const bundlePaths = new Set<string>()
  for (const path of paths) {
    if (prefix && !path.startsWith(prefix)) continue
    const bundlePath = path.slice(prefix.length)
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
  return { files, truncated, logo }
}

/** Batch-fetch raw texts by REPO path via the GraphQL blobs connection. */
async function fetchTextsByRepoPath(
  token: string | null,
  config: RepoConfig,
  repoPaths: string[]
): Promise<Record<string, string>> {
  const texts: Record<string, string> = {}
  const chunkSize = 50
  for (let i = 0; i < repoPaths.length; i += chunkSize) {
    const chunk = repoPaths.slice(i, i + chunkSize)
    try {
      const res = await fetch(`https://${config.host}/api/graphql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          query: `query($fullPath: ID!, $ref: String!, $paths: [String!]!) {
            project(fullPath: $fullPath) { repository { blobs(ref: $ref, paths: $paths) { nodes { path rawTextBlob } } } }
          }`,
          variables: { fullPath: projectPath(config), ref: config.branch, paths: chunk },
        }),
        cache: 'no-store',
      })
      const data = await res.json()
      const nodes: { path: string; rawTextBlob: string | null }[] =
        data?.data?.project?.repository?.blobs?.nodes || []
      for (const node of nodes) {
        if (typeof node.rawTextBlob === 'string') texts[node.path] = node.rawTextBlob
      }
    } catch {
      // Missing entries are simply absent from the result.
    }
  }
  return texts
}

/** Batch-fetch the raw text of bundle files. */
export async function fetchFileTexts(
  token: string | null,
  config: RepoConfig,
  bundlePaths: string[]
): Promise<Record<string, string>> {
  const prefix = config.root ? `${config.root}/` : ''
  const byRepoPath = await fetchTextsByRepoPath(
    token,
    config,
    bundlePaths.map((p) => prefix + p)
  )
  const texts: Record<string, string> = {}
  for (const p of bundlePaths) {
    const text = byRepoPath[prefix + p]
    if (typeof text === 'string') texts[p] = text
  }
  return texts
}

/** Batch-fetch frontmatter metadata for markdown files. */
export async function fetchFileMeta(
  token: string | null,
  config: RepoConfig,
  paths: string[]
): Promise<Record<string, FileMeta>> {
  const texts = await fetchFileTexts(token, config, paths)
  const meta: Record<string, FileMeta> = {}
  for (const [path, text] of Object.entries(texts)) {
    meta[path] = extractMeta(text)
  }
  return meta
}

/**
 * Move files (and whole subtrees) in a single commit via the commits API,
 * which supports native move actions. Returns the number of files moved.
 */
export async function movePaths(
  token: string,
  config: RepoConfig,
  moves: PathMove[],
  message: string,
  contentRewrite?: (path: string, content: string) => string
): Promise<number> {
  const { paths, truncated } = await listTree(token, config)
  if (truncated) throw new GitHubError(413, 'Repository tree is too large for a safe move')
  const existing = new Set(paths)

  let texts: Record<string, string> = {}
  if (contentRewrite) {
    texts = await fetchTextsByRepoPath(
      token,
      config,
      paths.filter((p) => p.endsWith('.md'))
    )
  }

  type Action = {
    action: 'move' | 'update'
    file_path: string
    previous_path?: string
    content?: string
  }
  const actions: Action[] = []
  let moved = 0

  for (const path of paths) {
    const move = moves.find((m) => path === m.from || path.startsWith(`${m.from}/`))
    const rewritten =
      contentRewrite && path.endsWith('.md') && texts[path] !== undefined
        ? contentRewrite(path, texts[path])
        : undefined
    const changed = rewritten !== undefined && rewritten !== texts[path]
    if (move) {
      const newPath = move.to + path.slice(move.from.length)
      if (existing.has(newPath)) throw new GitHubError(409, `${newPath} already exists`)
      actions.push({
        action: 'move',
        file_path: newPath,
        previous_path: path,
        ...(changed ? { content: rewritten } : {}),
      })
      moved++
    } else if (changed) {
      actions.push({ action: 'update', file_path: path, content: rewritten })
    }
  }
  if (moved === 0) throw new GitHubError(404, 'Nothing to move')

  await gl(token, config, `/projects/${projectId(config)}/repository/commits`, {
    method: 'POST',
    body: JSON.stringify({ branch: config.branch, commit_message: message, actions }),
  })
  return moved
}

/** Who last touched a file (best effort, for the page footer). */
export async function lastCommit(
  token: string | null,
  config: RepoConfig,
  repoPath: string
): Promise<LastCommit | null> {
  const commits = await gl(
    token,
    config,
    `/projects/${projectId(config)}/repository/commits?path=${encodeURIComponent(repoPath)}&ref_name=${encodeURIComponent(config.branch)}&per_page=1`
  )
  const head = Array.isArray(commits) ? commits[0] : null
  if (!head) return null
  return {
    date: head.authored_date || head.committed_date || '',
    name: head.author_name || 'unknown',
    login: null,
    avatarUrl: null,
    authorUrl: null,
  }
}

/** Effective write access: Developer (30) or higher on the project. */
export async function canWrite(token: string, config: RepoConfig): Promise<boolean | null> {
  try {
    const project = await gl(token, config, `/projects/${projectId(config)}`)
    const levels = [
      project?.permissions?.project_access?.access_level || 0,
      project?.permissions?.group_access?.access_level || 0,
    ]
    return Math.max(...levels) >= 30
  } catch {
    return false
  }
}

export async function repoExists(token: string | null, config: RepoConfig): Promise<boolean> {
  try {
    await gl(token, config, `/projects/${projectId(config)}`)
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
    `${apiBase(config)}${filesUrl(config, repoPath)}/raw?ref=${encodeURIComponent(config.branch)}`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
    }
  )
}

/** Validate a token and return its user (for PAT sign-in). */
export async function userInfo(token: string, config: RepoConfig): Promise<{ login: string; avatarUrl: string }> {
  const user = await gl(token, config, '/user')
  return { login: user.username, avatarUrl: user.avatar_url || '' }
}

export function webUrl(config: RepoConfig, repoPath: string): string {
  return `https://${config.host}/${projectPath(config)}/-/blob/${config.branch}/${repoPath}`
}

export function historyUrl(config: RepoConfig, repoPath: string): string {
  return `https://${config.host}/${projectPath(config)}/-/commits/${config.branch}/${repoPath}`
}

export function repoHomeUrl(config: RepoConfig): string {
  return `https://${config.host}/${projectPath(config)}`
}
