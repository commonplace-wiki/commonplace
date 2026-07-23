import { execFile } from 'child_process'
import crypto from 'crypto'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { projectPath, type RepoConfig } from './config'
import * as github from './github'
import * as gitlab from './gitlab'
import type { LastCommit } from './github'

/**
 * Server-side read mirror for the GitHub/GitLab providers: a clone of the
 * wiki repository on local disk, so reads are served from the filesystem
 * (via the `local` provider implementation) instead of paying an API
 * round-trip per file. Always on when supported — a failing clone (no git
 * binary, no disk, unreachable remote) transparently falls back to the API.
 *
 * The server holds no credential of its own, so the mirror is cloned and
 * fetched with the token of whichever signed-in user triggers the sync
 * (anonymous syncs work for public repositories). Freshness is
 * stale-while-revalidate: reads serve the current checkout immediately and a
 * background fetch runs when the last sync is older than SYNC_TTL_MS. After
 * every write through the app the mirror is synced before the response
 * returns (bounded by a timeout), so users read their own writes.
 *
 * Reading from disk bypasses the provider's per-request access control, so
 * every mirror read is gated by a per-token authorization check against the
 * provider API, cached for a few minutes. A token that fails the check (or
 * any mirror failure) falls back to the direct API path, which preserves
 * today's error semantics exactly.
 */

const execFileAsync = promisify(execFile)

/** How long a synced checkout is served before the remote is checked again. */
const SYNC_TTL_MS = 60_000
const AUTH_TTL_MS = 5 * 60_000
const AUTH_NEGATIVE_TTL_MS = 30_000
const CLONE_RETRY_MS = 5 * 60_000
const SYNC_RETRY_MS = 15_000
const WRITE_SYNC_TIMEOUT_MS = 5_000

export function mirrorSupported(config: RepoConfig): boolean {
  return config.provider !== 'local' && !state.unsupported
}

function mirrorDir(config: RepoConfig): string {
  const id = crypto
    .createHash('sha256')
    .update(`${config.host}/${projectPath(config)}#${config.branch}`)
    .digest('hex')
    .slice(0, 12)
  return path.join(os.tmpdir(), `commonplace-mirror-${id}`)
}

function remoteUrl(config: RepoConfig): string {
  return `https://${config.host}/${projectPath(config)}.git`
}

/**
 * Credentials reach git through environment-supplied config, never the
 * command line (visible in `ps`) and never the on-disk remote URL.
 */
function gitEnv(token: string | null, config: RepoConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  if (token) {
    // GitLab requires the "oauth2" basic-auth user for OAuth tokens (and
    // accepts it for PATs); GitHub ignores the user when the password is a
    // token, "x-access-token" is the convention.
    const user = config.provider === 'gitlab' ? 'oauth2' : 'x-access-token'
    const basic = Buffer.from(`${user}:${token}`).toString('base64')
    env.GIT_CONFIG_COUNT = '1'
    env.GIT_CONFIG_KEY_0 = 'http.extraheader'
    env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`
  }
  return env
}

async function git(
  cwd: string,
  args: string[],
  token: string | null,
  config: RepoConfig
): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    env: gitEnv(token, config),
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

const state = {
  /** git itself is unusable (not installed): stop trying for good. */
  unsupported: false,
  /** A clone exists on disk and can serve reads. */
  ready: false,
  cloning: false,
  /** Epoch ms of the last successful fetch (0 = age unknown, sync soon). */
  lastSyncAt: 0,
  syncFailedAt: 0,
  cloneFailedAt: 0,
  syncsInFlight: 0,
}

// Clone/fetch/reset are serialized: concurrent git processes would race on
// the repository. The queue also guarantees a post-write sync starts only
// after any in-flight fetch, so it always sees the write's commit.
let gitQueue: Promise<unknown> = Promise.resolve()

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = gitQueue.then(fn, fn)
  gitQueue = run.catch(() => {})
  return run
}

// token -> may this token read the repository, per the provider API.
const authCache = new Map<string, { result: Promise<boolean>; expiresAt: number }>()

function authorized(token: string | null, config: RepoConfig): Promise<boolean> {
  const key = token ? crypto.createHash('sha256').update(token).digest('hex') : 'anonymous'
  const now = Date.now()
  const hit = authCache.get(key)
  if (hit && hit.expiresAt > now) return hit.result
  if (authCache.size > 500) {
    for (const [k, v] of authCache) {
      if (v.expiresAt <= now) authCache.delete(k)
    }
  }
  const check = config.provider === 'gitlab' ? gitlab.repoExists(token, config) : github.repoExists(token, config)
  const entry = { result: check.catch(() => false), expiresAt: now + AUTH_TTL_MS }
  authCache.set(key, entry)
  // Denials expire sooner, so a transient API failure or a just-granted
  // access does not lock a reader onto the slow path for long.
  entry.result.then((ok) => {
    if (!ok) entry.expiresAt = now + AUTH_NEGATIVE_TTL_MS
  })
  return entry.result
}

async function detectExistingClone(config: RepoConfig): Promise<boolean> {
  try {
    return (await fs.stat(path.join(mirrorDir(config), '.git'))).isDirectory()
  } catch {
    return false
  }
}

async function cloneMirror(token: string | null, config: RepoConfig): Promise<void> {
  const dir = mirrorDir(config)
  // Clone next to the target and rename, so a killed clone never leaves a
  // half-populated directory that would be mistaken for a working mirror.
  const tmp = `${dir}.cloning`
  await fs.rm(tmp, { recursive: true, force: true })
  await fs.mkdir(path.dirname(dir), { recursive: true })
  await git(
    path.dirname(dir),
    ['clone', '--quiet', '--single-branch', '--branch', config.branch, remoteUrl(config), tmp],
    token,
    config
  )
  await fs.rm(dir, { recursive: true, force: true })
  await fs.rename(tmp, dir)
}

async function syncMirror(token: string | null, config: RepoConfig): Promise<void> {
  const dir = mirrorDir(config)
  await git(dir, ['fetch', '--quiet', 'origin', config.branch], token, config)
  await git(dir, ['reset', '--quiet', '--hard', 'FETCH_HEAD'], null, config)
}

/** Never rejects; failures are logged and throttle the next attempt. */
function startSync(token: string | null, config: RepoConfig): Promise<void> {
  state.syncsInFlight++
  return enqueue(() => syncMirror(token, config))
    .then(() => {
      state.lastSyncAt = Date.now()
      state.syncFailedAt = 0
    })
    .catch((err) => {
      state.syncFailedAt = Date.now()
      const detail = err instanceof Error ? err.message : String(err)
      console.warn(`Mirror sync failed (serving the last synced state): ${detail}`)
    })
    .finally(() => {
      state.syncsInFlight--
    })
}

/**
 * The gate every read goes through: returns a local-provider config pointing
 * at the mirror checkout when the mirror may serve this request, or null to
 * fall back to the provider API (mirror disabled, still cloning, recently
 * failed, or the token is not authorized to read the repository).
 */
export async function mirrorConfig(token: string | null, config: RepoConfig): Promise<RepoConfig | null> {
  if (!mirrorSupported(config)) return null
  if (!(await authorized(token, config))) return null
  if (!state.ready) {
    if (state.cloning || Date.now() - state.cloneFailedAt < CLONE_RETRY_MS) return null
    if (await detectExistingClone(config)) {
      // A clone from a previous process: serve it, its age is unknown so the
      // staleness check below refreshes it right away.
      state.ready = true
    } else if (state.cloning || state.ready) {
      return null // a concurrent request started the clone during the await
    } else {
      state.cloning = true
      void enqueue(() => cloneMirror(token, config))
        .then(() => {
          state.ready = true
          state.lastSyncAt = Date.now()
        })
        .catch((err) => {
          state.cloneFailedAt = Date.now()
          if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') state.unsupported = true
          const detail = err instanceof Error ? err.message : String(err)
          console.warn(`Mirror clone failed (reads use the ${config.provider} API): ${detail}`)
        })
        .finally(() => {
          state.cloning = false
        })
      return null // this request is served by the API while the clone runs
    }
  }
  const stale = Date.now() - state.lastSyncAt > SYNC_TTL_MS
  const retryOk = Date.now() - state.syncFailedAt > SYNC_RETRY_MS
  if (stale && retryOk && state.syncsInFlight === 0) void startSync(token, config)
  return { ...config, provider: 'local', dir: mirrorDir(config) }
}

/**
 * Bring the mirror up to date after a successful write, so the writer's next
 * read sees it. Bounded by a timeout: a slow fetch must not hold the save
 * response hostage — the sync keeps running in the background.
 */
export async function afterWrite(token: string | null, config: RepoConfig): Promise<void> {
  if (!mirrorSupported(config) || !state.ready) return
  const sync = startSync(token, config)
  await Promise.race([
    sync,
    new Promise<void>((resolve) => setTimeout(resolve, WRITE_SYNC_TIMEOUT_MS).unref?.()),
  ])
}

const GITHUB_NOREPLY = /^(?:\d+\+)?([a-zA-Z0-9-]+)@users\.noreply\.github\.com$/i
const GITLAB_NOREPLY = /^\d+-([^@]+)@users\.noreply\./i

/**
 * Last-touched info from the mirror's git log. Commits written through the
 * providers' APIs carry the user's (often noreply) email, from which the
 * login — and on GitHub the avatar — can be recovered without an API call.
 */
export async function lastCommit(
  mirror: RepoConfig,
  config: RepoConfig,
  repoPath: string
): Promise<LastCommit | null> {
  if (!mirror.dir) return null
  const out = await git(
    mirror.dir,
    ['log', '-1', '--format=%aI%x00%an%x00%ae', '--', repoPath],
    null,
    config
  ).catch(() => '')
  const [date, name, email] = out.trim().split('\0')
  if (!date) return null
  const noreply = config.provider === 'gitlab' ? GITLAB_NOREPLY : GITHUB_NOREPLY
  const login = (email || '').match(noreply)?.[1] || null
  return {
    date,
    name: name || 'unknown',
    login,
    avatarUrl:
      login && config.provider === 'github' ? `https://avatars.githubusercontent.com/${login}` : null,
    authorUrl: login ? `https://${config.host}/${login}` : null,
  }
}
