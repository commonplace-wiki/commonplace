import type { RepoConfig } from './config'
import * as github from './github'
import * as gitlab from './gitlab'
import * as local from './local'

/**
 * Provider dispatch: every route talks to the wiki repository through these
 * functions, which route to the GitHub, GitLab, or local implementation based
 * on config.provider. The `sha` values are provider-opaque conflict tokens
 * (GitHub: blob sha, GitLab: last_commit_id, local: blob sha).
 */

export { GitHubError as RepoError, GitHubError } from './github'
export type { FileMeta, LastCommit, MentionUser, PathMove, RepoFile, TreeEntry } from './github'

export function getFile(token: string | null, config: RepoConfig, repoPath: string) {
  if (config.provider === 'gitlab') return gitlab.getFile(token, config, repoPath)
  if (config.provider === 'local') return local.getFile(token, config, repoPath)
  return github.getFile(token, config, repoPath)
}

export function putFile(
  token: string,
  config: RepoConfig,
  repoPath: string,
  content: string,
  message: string,
  sha?: string
) {
  if (config.provider === 'gitlab') return gitlab.putFile(token, config, repoPath, content, message, sha)
  if (config.provider === 'local') return local.putFile(token, config, repoPath, content, message, sha)
  return github.putFile(token, config, repoPath, content, message, sha)
}

export function putFileBase64(
  token: string,
  config: RepoConfig,
  repoPath: string,
  base64Content: string,
  message: string,
  sha?: string
) {
  if (config.provider === 'gitlab') {
    return gitlab.putFileBase64(token, config, repoPath, base64Content, message, sha)
  }
  if (config.provider === 'local') {
    return local.putFileBase64(token, config, repoPath, base64Content, message, sha)
  }
  return github.putFileBase64(token, config, repoPath, base64Content, message, sha)
}

export function deleteFile(
  token: string,
  config: RepoConfig,
  repoPath: string,
  sha: string,
  message: string
) {
  if (config.provider === 'gitlab') return gitlab.deleteFile(token, config, repoPath, sha, message)
  if (config.provider === 'local') return local.deleteFile(token, config, repoPath, sha, message)
  return github.deleteFile(token, config, repoPath, sha, message)
}

export function listMarkdownFiles(token: string | null, config: RepoConfig) {
  if (config.provider === 'gitlab') return gitlab.listMarkdownFiles(token, config)
  if (config.provider === 'local') return local.listMarkdownFiles(token, config)
  return github.listMarkdownFiles(token, config)
}

export function fetchFileTexts(token: string | null, config: RepoConfig, bundlePaths: string[]) {
  if (config.provider === 'gitlab') return gitlab.fetchFileTexts(token, config, bundlePaths)
  if (config.provider === 'local') return local.fetchFileTexts(token, config, bundlePaths)
  return github.fetchFileTexts(token, config, bundlePaths)
}

export function fetchFileMeta(token: string | null, config: RepoConfig, paths: string[]) {
  if (config.provider === 'gitlab') return gitlab.fetchFileMeta(token, config, paths)
  if (config.provider === 'local') return local.fetchFileMeta(token, config, paths)
  return github.fetchFileMeta(token, config, paths)
}

export function movePaths(
  token: string,
  config: RepoConfig,
  moves: github.PathMove[],
  message: string,
  contentRewrite?: (path: string, content: string) => string
) {
  if (config.provider === 'gitlab') return gitlab.movePaths(token, config, moves, message, contentRewrite)
  if (config.provider === 'local') return local.movePaths(token, config, moves, message, contentRewrite)
  return github.movePaths(token, config, moves, message, contentRewrite)
}

export function lastCommit(token: string | null, config: RepoConfig, repoPath: string) {
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

export function rawResponse(token: string | null, config: RepoConfig, repoPath: string) {
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
