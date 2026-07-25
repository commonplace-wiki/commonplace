import { execFile } from 'child_process'
import crypto from 'crypto'
import { constants as fsConstants, promises as fs } from 'fs'
import path from 'path'
import { promisify } from 'util'
import type { RepoConfig } from './config'
import {
  extractMeta,
  GitHubError,
  type FileMeta,
  type LastCommit,
  type MentionUser,
  type PathMove,
  type RepoFile,
  type TreeEntry,
} from './github'

/**
 * Local-filesystem provider for demos and offline use: GIT_REPO points at a
 * directory on the server. Files are read and written directly; when the
 * directory is a git worktree, every write is also committed so log.md and
 * `git log` stay meaningful. Without git the wiki still works — commits are
 * skipped and "last edited" information is unavailable.
 *
 * The conflict token (`sha`) is the git blob sha of the file content, computed
 * locally, so it matches what `git hash-object` would print.
 */

const execFileAsync = promisify(execFile)

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: dir, maxBuffer: 16 * 1024 * 1024 })
  return stdout
}

function repoDir(config: RepoConfig): string {
  if (!config.dir) throw new GitHubError(500, 'Local repository directory is not configured')
  return config.dir
}

/** Absolute filesystem path for a repo-relative path, confined to the repo. */
function absPath(config: RepoConfig, repoPath: string): string {
  const dir = repoDir(config)
  const resolved = path.resolve(dir, repoPath)
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) {
    throw new GitHubError(400, `Invalid path: ${repoPath}`)
  }
  return resolved
}

/** Git blob sha of the content, identical to what GitHub reports for the file. */
function blobSha(buf: Buffer): string {
  return crypto
    .createHash('sha1')
    .update(`blob ${buf.length}\0`)
    .update(buf)
    .digest('hex')
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT' || (err as NodeJS.ErrnoException)?.code === 'ENOTDIR'
}

// Whether the directory is a git worktree, cached per directory. False also
// covers a missing git binary: the provider then runs commit-less.
const gitRepoCache = new Map<string, Promise<boolean>>()

function isGitRepo(dir: string): Promise<boolean> {
  let cached = gitRepoCache.get(dir)
  if (!cached) {
    cached = git(dir, ['rev-parse', '--is-inside-work-tree'])
      .then((out) => out.trim() === 'true')
      .catch(() => false)
    gitRepoCache.set(dir, cached)
  }
  return cached
}

// Auto-create the deployment's configured directory on first use, so
// GIT_REPO=/tmp/wiki works with nothing prepared. One path level only (no
// recursive mkdir): a missing parent means a typo'd path, which should fail,
// not silently produce an empty wiki. Never applies to derived local configs
// like the read mirror — see RepoConfig.autoCreate.
const ensureCache = new Map<string, Promise<void>>()

function ensureDir(config: RepoConfig): Promise<void> {
  if (!config.autoCreate) return Promise.resolve()
  const dir = repoDir(config)
  let cached = ensureCache.get(dir)
  if (!cached) {
    cached = (async () => {
      try {
        await fs.stat(dir)
        return // exists: whatever it is, the normal code paths handle it
      } catch (err) {
        if (!isMissing(err)) throw err
      }
      await fs.mkdir(dir)
      // Best effort: without git the wiki still works, commit-less.
      await git(dir, ['init', '--quiet']).catch(() => {})
    })()
    cached.catch(() => ensureCache.delete(dir)) // retry on the next request
    ensureCache.set(dir, cached)
  }
  return cached
}

// Extra -c flags supplying a commit identity when the repo has none configured.
const identityCache = new Map<string, Promise<string[]>>()

function identityArgs(dir: string): Promise<string[]> {
  let cached = identityCache.get(dir)
  if (!cached) {
    cached = git(dir, ['config', 'user.name'])
      .then((out) => (out.trim() ? [] : Promise.reject(new Error('unset'))))
      .catch(() => ['-c', 'user.name=Commonplace', '-c', 'user.email=commonplace@localhost'])
    identityCache.set(dir, cached)
  }
  return cached
}

// Writes are serialized: concurrent requests would otherwise race on the git
// index (a page save immediately commits both the page and log.md).
let writeLock: Promise<unknown> = Promise.resolve()

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeLock.then(fn, fn)
  writeLock = run.catch(() => {})
  return run
}

/**
 * Stage the given repo-relative paths (or everything, for moves) and commit.
 * Best effort: the filesystem write has already succeeded, so a failing commit
 * (e.g. nothing changed) must not fail the request.
 */
async function commit(config: RepoConfig, message: string, paths: string[] | 'all'): Promise<void> {
  const dir = repoDir(config)
  if (!(await isGitRepo(dir))) return
  try {
    const pathspec = paths === 'all' ? ['.'] : paths
    await git(dir, ['add', '-A', '--', ...pathspec])
    const identity = await identityArgs(dir)
    await git(dir, [...identity, 'commit', '-m', message])
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    if (!/nothing (added )?to commit/.test(detail)) {
      console.warn(`Local git commit failed (the file change itself is saved): ${detail}`)
    }
  }
}

async function readRepoFile(config: RepoConfig, repoPath: string): Promise<{ buf: Buffer; sha: string }> {
  let buf: Buffer
  try {
    buf = await fs.readFile(absPath(config, repoPath))
  } catch (err) {
    if (isMissing(err)) throw new GitHubError(404, `${repoPath} not found`)
    throw err
  }
  return { buf, sha: blobSha(buf) }
}

export async function getFile(_token: string | null, config: RepoConfig, repoPath: string): Promise<RepoFile> {
  await ensureDir(config).catch(() => {})
  const stat = await fs.stat(absPath(config, repoPath)).catch((err) => {
    if (isMissing(err)) throw new GitHubError(404, `${repoPath} not found`)
    throw err
  })
  if (stat.isDirectory()) throw new GitHubError(400, `${repoPath} is a directory, not a file`)
  const { buf, sha } = await readRepoFile(config, repoPath)
  return { content: buf.toString('utf8'), sha }
}

async function writeRepoFile(
  config: RepoConfig,
  repoPath: string,
  buf: Buffer,
  message: string,
  sha?: string
): Promise<string> {
  return withWriteLock(async () => {
    await ensureDir(config).catch(() => {})
    const target = absPath(config, repoPath)
    let currentSha: string | null = null
    try {
      currentSha = blobSha(await fs.readFile(target))
    } catch (err) {
      if (!isMissing(err)) throw err
    }
    // Same conflict semantics as the GitHub Contents API: creating over an
    // existing file needs its sha, updating with a stale sha is a conflict.
    if (!sha && currentSha !== null) {
      throw new GitHubError(422, `${repoPath} already exists`)
    }
    if (sha && currentSha !== sha) {
      throw new GitHubError(409, `${repoPath} changed since it was loaded`)
    }
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, buf)
    await commit(config, message, [repoPath])
    return blobSha(buf)
  })
}

export function putFile(
  _token: string,
  config: RepoConfig,
  repoPath: string,
  content: string,
  message: string,
  sha?: string
): Promise<string> {
  return writeRepoFile(config, repoPath, Buffer.from(content, 'utf8'), message, sha)
}

export function putFileBase64(
  _token: string,
  config: RepoConfig,
  repoPath: string,
  base64Content: string,
  message: string,
  sha?: string
): Promise<string> {
  return writeRepoFile(config, repoPath, Buffer.from(base64Content, 'base64'), message, sha)
}

/** Remove now-empty parent directories, from `repoPath` up to the repo root. */
async function pruneEmptyDirs(config: RepoConfig, repoPath: string): Promise<void> {
  const dir = repoDir(config)
  let parent = path.dirname(absPath(config, repoPath))
  while (parent !== dir && parent.startsWith(dir + path.sep)) {
    try {
      await fs.rmdir(parent)
    } catch {
      return // not empty (or already gone): stop climbing
    }
    parent = path.dirname(parent)
  }
}

export function deleteFile(
  _token: string,
  config: RepoConfig,
  repoPath: string,
  sha: string,
  message: string
): Promise<void> {
  return withWriteLock(async () => {
    const { sha: currentSha } = await readRepoFile(config, repoPath)
    if (currentSha !== sha) {
      throw new GitHubError(409, `${repoPath} changed since it was loaded`)
    }
    await fs.unlink(absPath(config, repoPath))
    await pruneEmptyDirs(config, repoPath)
    await commit(config, message, [repoPath])
  })
}

/** All regular files below `rel` (repo-relative), excluding .git. */
async function walkFiles(config: RepoConfig, rel: string): Promise<string[]> {
  const out: string[] = []
  let entries
  try {
    entries = await fs.readdir(rel ? absPath(config, rel) : repoDir(config), { withFileTypes: true })
  } catch (err) {
    if (isMissing(err)) return out
    throw err
  }
  for (const entry of entries) {
    if (entry.name === '.git') continue
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      out.push(...(await walkFiles(config, entryRel)))
    } else if (entry.isFile()) {
      out.push(entryRel)
    }
  }
  return out
}

export async function movePaths(
  _token: string,
  config: RepoConfig,
  moves: PathMove[],
  message: string,
  contentRewrite?: (path: string, content: string) => string
): Promise<number> {
  return withWriteLock(async () => {
    const all = await walkFiles(config, '')
    const existing = new Set(all)
    const renames: PathMove[] = []
    // Rewritten content keyed by the file's FINAL path (post-move).
    const rewrites = new Map<string, string>()
    let moved = 0

    for (const repoPath of all) {
      const move = moves.find((m) => repoPath === m.from || repoPath.startsWith(`${m.from}/`))
      const finalPath = move ? move.to + repoPath.slice(move.from.length) : repoPath
      if (move) {
        if (existing.has(finalPath)) {
          throw new GitHubError(409, `${finalPath} already exists`)
        }
        renames.push({ from: repoPath, to: finalPath })
        moved++
      }
      if (contentRewrite && repoPath.endsWith('.md')) {
        const text = (await readRepoFile(config, repoPath)).buf.toString('utf8')
        // Like the GitHub implementation, the rewrite sees the pre-move path.
        const rewritten = contentRewrite(repoPath, text)
        if (rewritten !== text) rewrites.set(finalPath, rewritten)
      }
    }
    if (moved === 0) {
      throw new GitHubError(404, 'Nothing to move')
    }

    for (const rename of renames) {
      const target = absPath(config, rename.to)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.rename(absPath(config, rename.from), target)
    }
    for (const rename of renames) {
      await pruneEmptyDirs(config, rename.from)
    }
    for (const [finalPath, content] of rewrites) {
      await fs.writeFile(absPath(config, finalPath), content)
    }
    await commit(config, message, 'all')
    return moved
  })
}

export async function lastCommit(
  _token: string | null,
  config: RepoConfig,
  repoPath: string
): Promise<LastCommit | null> {
  const dir = repoDir(config)
  if (!(await isGitRepo(dir))) return null
  const out = await git(dir, ['log', '-1', '--format=%aI%x00%an', '--', repoPath]).catch(() => '')
  const [date, name] = out.trim().split('\0')
  if (!date) return null
  return { date, name: name || 'unknown', login: null, avatarUrl: null, authorUrl: null }
}

/** Write access means the server process can write to the directory. */
export async function canWrite(_token: string, config: RepoConfig): Promise<boolean | null> {
  try {
    await ensureDir(config)
    await fs.access(repoDir(config), fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}

export async function repoExists(_token: string | null, config: RepoConfig): Promise<boolean> {
  try {
    await ensureDir(config)
    return (await fs.stat(repoDir(config))).isDirectory()
  } catch {
    return false
  }
}

const MIME_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
}

export async function rawResponse(
  _token: string | null,
  config: RepoConfig,
  repoPath: string
): Promise<Response> {
  try {
    const { buf } = await readRepoFile(config, repoPath)
    const ext = path.extname(repoPath).slice(1).toLowerCase()
    return new Response(new Uint8Array(buf), {
      headers: { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' },
    })
  } catch (err) {
    const status = err instanceof GitHubError ? err.status : 500
    return new Response('Not found', { status })
  }
}

/** The local committer identity; doubles as the demo sign-in user. */
export async function localLogin(config: RepoConfig): Promise<string> {
  try {
    const name = (await git(repoDir(config), ['config', 'user.name'])).trim()
    if (name) return name
  } catch {
    // no git or no identity configured
  }
  return 'local'
}

export async function userInfo(
  _token: string,
  config: RepoConfig
): Promise<{ login: string; avatarUrl: string }> {
  return { login: await localLogin(config), avatarUrl: '' }
}

/** No user directory locally: the @-mention typeahead has nothing to offer. */
export async function listCollaborators(_token: string, _config: RepoConfig): Promise<MentionUser[]> {
  return []
}

// There is no web host to link to.
export function webUrl(_config: RepoConfig, _repoPath: string): string {
  return ''
}

export function historyUrl(_config: RepoConfig, _repoPath: string): string {
  return ''
}

export function repoHomeUrl(_config: RepoConfig): string {
  return ''
}

export async function fetchFileTexts(
  _token: string | null,
  config: RepoConfig,
  bundlePaths: string[]
): Promise<Record<string, string>> {
  const prefix = config.root ? `${config.root}/` : ''
  const texts: Record<string, string> = {}
  await Promise.all(
    bundlePaths.map(async (p) => {
      try {
        texts[p] = (await readRepoFile(config, prefix + p)).buf.toString('utf8')
      } catch {
        // missing entries are simply absent from the result
      }
    })
  )
  return texts
}

export async function fetchFileMeta(
  _token: string | null,
  config: RepoConfig,
  paths: string[]
): Promise<Record<string, FileMeta>> {
  const texts = await fetchFileTexts(null, config, paths)
  const meta: Record<string, FileMeta> = {}
  for (const [p, text] of Object.entries(texts)) {
    meta[p] = extractMeta(text)
  }
  return meta
}

export async function listMarkdownFiles(
  _token: string | null,
  config: RepoConfig
): Promise<{ files: TreeEntry[]; truncated: boolean; logo: string | null }> {
  await ensureDir(config).catch(() => {})
  const bundleFiles = await walkFiles(config, config.root)
  const prefix = config.root ? `${config.root}/` : ''
  const files: TreeEntry[] = []
  const bundlePaths = new Set<string>()
  for (const repoPath of bundleFiles) {
    const bundlePath = repoPath.slice(prefix.length)
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
  return { files, truncated: false, logo }
}
