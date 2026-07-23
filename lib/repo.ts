import type { RepoConfig } from './config'
import * as github from './github'
import * as gitlab from './gitlab'
import * as local from './local'
import * as mirror from './mirror'

/**
 * Provider dispatch: every route talks to the wiki repository through these
 * functions, which route to the GitHub, GitLab, or local implementation based
 * on config.provider. The `sha` values are provider-opaque conflict tokens
 * (GitHub: blob sha, GitLab: last_commit_id, local: blob sha).
 *
 * For the GitHub/GitLab providers, reads are served from a local clone of
 * the repository when available (see mirror.ts) through the local
 * implementation; writes stay on the provider API — that keeps per-user
 * commit attribution and the provider's permission checks — and re-sync the
 * mirror afterwards.
 */

export { GitHubError as RepoError, GitHubError } from './github'
export type { FileMeta, LastCommit, MentionUser, PathMove, RepoFile, TreeEntry } from './github'

export async function getFile(token: string | null, config: RepoConfig, repoPath: string) {
  const mirrored = await mirror.mirrorConfig(token, config)
  if (mirrored) return local.getFile(token, mirrored, repoPath)
  if (config.provider === 'gitlab') return gitlab.getFile(token, config, repoPath)
  if (config.provider === 'local') return local.getFile(token, config, repoPath)
  return github.getFile(token, config, repoPath)
}

export async function putFile(
  token: string,
  config: RepoConfig,
  repoPath: string,
  content: string,
  message: string,
  sha?: string
) {
  const result = await (config.provider === 'gitlab'
    ? gitlab.putFile(token, config, repoPath, content, message, sha)
    : config.provider === 'local'
      ? local.putFile(token, config, repoPath, content, message, sha)
      : github.putFile(token, config, repoPath, content, message, sha))
  await mirror.afterWrite(token, config)
  return result
}

export async function putFileBase64(
  token: string,
  config: RepoConfig,
  repoPath: string,
  base64Content: string,
  message: string,
  sha?: string
) {
  const result = await (config.provider === 'gitlab'
    ? gitlab.putFileBase64(token, config, repoPath, base64Content, message, sha)
    : config.provider === 'local'
      ? local.putFileBase64(token, config, repoPath, base64Content, message, sha)
      : github.putFileBase64(token, config, repoPath, base64Content, message, sha))
  await mirror.afterWrite(token, config)
  return result
}

export async function deleteFile(
  token: string,
  config: RepoConfig,
  repoPath: string,
  sha: string,
  message: string
) {
  await (config.provider === 'gitlab'
    ? gitlab.deleteFile(token, config, repoPath, sha, message)
    : config.provider === 'local'
      ? local.deleteFile(token, config, repoPath, sha, message)
      : github.deleteFile(token, config, repoPath, sha, message))
  await mirror.afterWrite(token, config)
}

export async function listMarkdownFiles(token: string | null, config: RepoConfig) {
  const mirrored = await mirror.mirrorConfig(token, config)
  if (mirrored) return local.listMarkdownFiles(token, mirrored)
  if (config.provider === 'gitlab') return gitlab.listMarkdownFiles(token, config)
  if (config.provider === 'local') return local.listMarkdownFiles(token, config)
  return github.listMarkdownFiles(token, config)
}

export async function fetchFileTexts(token: string | null, config: RepoConfig, bundlePaths: string[]) {
  const mirrored = await mirror.mirrorConfig(token, config)
  if (mirrored) return local.fetchFileTexts(token, mirrored, bundlePaths)
  if (config.provider === 'gitlab') return gitlab.fetchFileTexts(token, config, bundlePaths)
  if (config.provider === 'local') return local.fetchFileTexts(token, config, bundlePaths)
  return github.fetchFileTexts(token, config, bundlePaths)
}

export async function fetchFileMeta(token: string | null, config: RepoConfig, paths: string[]) {
  const mirrored = await mirror.mirrorConfig(token, config)
  if (mirrored) return local.fetchFileMeta(token, mirrored, paths)
  if (config.provider === 'gitlab') return gitlab.fetchFileMeta(token, config, paths)
  if (config.provider === 'local') return local.fetchFileMeta(token, config, paths)
  return github.fetchFileMeta(token, config, paths)
}

export async function movePaths(
  token: string,
  config: RepoConfig,
  moves: github.PathMove[],
  message: string,
  contentRewrite?: (path: string, content: string) => string
) {
  const result = await (config.provider === 'gitlab'
    ? gitlab.movePaths(token, config, moves, message, contentRewrite)
    : config.provider === 'local'
      ? local.movePaths(token, config, moves, message, contentRewrite)
      : github.movePaths(token, config, moves, message, contentRewrite))
  await mirror.afterWrite(token, config)
  return result
}

export async function lastCommit(token: string | null, config: RepoConfig, repoPath: string) {
  const mirrored = await mirror.mirrorConfig(token, config)
  if (mirrored) return mirror.lastCommit(mirrored, config, repoPath)
  if (config.provider === 'gitlab') return gitlab.lastCommit(token, config, repoPath)
  if (config.provider === 'local') return local.lastCommit(token, config, repoPath)
  return github.lastCommit(token, config, repoPath)
}

export function canWrite(token: string, config: RepoConfig, authMethod: string) {
  if (config.provider === 'gitlab') return gitlab.canWrite(token, config)
  if (config.provider === 'local') return local.canWrite(token, config)
  return github.canWrite(token, config, authMethod)
}

export function repoExists(token: string | null, config: RepoConfig) {
  if (config.provider === 'gitlab') return gitlab.repoExists(token, config)
  if (config.provider === 'local') return local.repoExists(token, config)
  return github.repoExists(token, config)
}

export async function rawResponse(token: string | null, config: RepoConfig, repoPath: string) {
  const mirrored = await mirror.mirrorConfig(token, config)
  if (mirrored) return local.rawResponse(token, mirrored, repoPath)
  if (config.provider === 'gitlab') return gitlab.rawResponse(token, config, repoPath)
  if (config.provider === 'local') return local.rawResponse(token, config, repoPath)
  return github.rawResponse(token, config, repoPath)
}

/** People with repository access, for the editor's @-mention typeahead. */
export function listCollaborators(token: string, config: RepoConfig) {
  if (config.provider === 'gitlab') return gitlab.listCollaborators(token, config)
  if (config.provider === 'local') return local.listCollaborators(token, config)
  return github.listCollaborators(token, config)
}

/** Validate a token and return its user (for PAT sign-in). */
export function userInfo(token: string, config: RepoConfig) {
  if (config.provider === 'gitlab') return gitlab.userInfo(token, config)
  if (config.provider === 'local') return local.userInfo(token, config)
  return github.userInfo(token)
}

export function webUrl(config: RepoConfig, repoPath: string) {
  if (config.provider === 'gitlab') return gitlab.webUrl(config, repoPath)
  if (config.provider === 'local') return local.webUrl(config, repoPath)
  return github.webUrl(config, repoPath)
}

export function historyUrl(config: RepoConfig, repoPath: string) {
  if (config.provider === 'gitlab') return gitlab.historyUrl(config, repoPath)
  if (config.provider === 'local') return local.historyUrl(config, repoPath)
  return github.historyUrl(config, repoPath)
}

export function repoHomeUrl(config: RepoConfig) {
  if (config.provider === 'gitlab') return gitlab.repoHomeUrl(config)
  if (config.provider === 'local') return local.repoHomeUrl(config)
  return github.repoHomeUrl(config)
}

/** Human-readable provider name for UI copy. */
export function providerLabel(config: RepoConfig | null): string {
  if (config?.provider === 'gitlab') return 'GitLab'
  if (config?.provider === 'local') return 'Local repository'
  return 'GitHub'
}
