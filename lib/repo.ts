import type { RepoConfig } from './config'
import * as github from './github'
import * as gitlab from './gitlab'

/**
 * Provider dispatch: every route talks to the wiki repository through these
 * functions, which route to the GitHub or GitLab implementation based on
 * config.provider. The `sha` values are provider-opaque conflict tokens
 * (GitHub: blob sha, GitLab: last_commit_id).
 */

export { GitHubError as RepoError, GitHubError } from './github'
export type { FileMeta, LastCommit, MentionUser, PathMove, RepoFile, TreeEntry } from './github'

export function getFile(token: string | null, config: RepoConfig, repoPath: string) {
  return config.provider === 'gitlab'
    ? gitlab.getFile(token, config, repoPath)
    : github.getFile(token, config, repoPath)
}

export function putFile(
  token: string,
  config: RepoConfig,
  repoPath: string,
  content: string,
  message: string,
  sha?: string
) {
  return config.provider === 'gitlab'
    ? gitlab.putFile(token, config, repoPath, content, message, sha)
    : github.putFile(token, config, repoPath, content, message, sha)
}

export function putFileBase64(
  token: string,
  config: RepoConfig,
  repoPath: string,
  base64Content: string,
  message: string,
  sha?: string
) {
  return config.provider === 'gitlab'
    ? gitlab.putFileBase64(token, config, repoPath, base64Content, message, sha)
    : github.putFileBase64(token, config, repoPath, base64Content, message, sha)
}

export function deleteFile(
  token: string,
  config: RepoConfig,
  repoPath: string,
  sha: string,
  message: string
) {
  return config.provider === 'gitlab'
    ? gitlab.deleteFile(token, config, repoPath, sha, message)
    : github.deleteFile(token, config, repoPath, sha, message)
}

export function listMarkdownFiles(token: string | null, config: RepoConfig) {
  return config.provider === 'gitlab'
    ? gitlab.listMarkdownFiles(token, config)
    : github.listMarkdownFiles(token, config)
}

export function fetchFileTexts(token: string | null, config: RepoConfig, bundlePaths: string[]) {
  return config.provider === 'gitlab'
    ? gitlab.fetchFileTexts(token, config, bundlePaths)
    : github.fetchFileTexts(token, config, bundlePaths)
}

export function fetchFileMeta(token: string | null, config: RepoConfig, paths: string[]) {
  return config.provider === 'gitlab'
    ? gitlab.fetchFileMeta(token, config, paths)
    : github.fetchFileMeta(token, config, paths)
}

export function movePaths(
  token: string,
  config: RepoConfig,
  moves: github.PathMove[],
  message: string,
  contentRewrite?: (path: string, content: string) => string
) {
  return config.provider === 'gitlab'
    ? gitlab.movePaths(token, config, moves, message, contentRewrite)
    : github.movePaths(token, config, moves, message, contentRewrite)
}

export function lastCommit(token: string | null, config: RepoConfig, repoPath: string) {
  return config.provider === 'gitlab'
    ? gitlab.lastCommit(token, config, repoPath)
    : github.lastCommit(token, config, repoPath)
}

export function canWrite(token: string, config: RepoConfig, authMethod: string) {
  return config.provider === 'gitlab'
    ? gitlab.canWrite(token, config)
    : github.canWrite(token, config, authMethod)
}

export function repoExists(token: string | null, config: RepoConfig) {
  return config.provider === 'gitlab'
    ? gitlab.repoExists(token, config)
    : github.repoExists(token, config)
}

export function rawResponse(token: string | null, config: RepoConfig, repoPath: string) {
  return config.provider === 'gitlab'
    ? gitlab.rawResponse(token, config, repoPath)
    : github.rawResponse(token, config, repoPath)
}

/** People with repository access, for the editor's @-mention typeahead. */
export function listCollaborators(token: string, config: RepoConfig) {
  return config.provider === 'gitlab'
    ? gitlab.listCollaborators(token, config)
    : github.listCollaborators(token, config)
}

/** Validate a token and return its user (for PAT sign-in). */
export function userInfo(token: string, config: RepoConfig) {
  return config.provider === 'gitlab' ? gitlab.userInfo(token, config) : github.userInfo(token)
}

export function webUrl(config: RepoConfig, repoPath: string) {
  return config.provider === 'gitlab' ? gitlab.webUrl(config, repoPath) : github.webUrl(config, repoPath)
}

export function historyUrl(config: RepoConfig, repoPath: string) {
  return config.provider === 'gitlab'
    ? gitlab.historyUrl(config, repoPath)
    : github.historyUrl(config, repoPath)
}

export function repoHomeUrl(config: RepoConfig) {
  return config.provider === 'gitlab' ? gitlab.repoHomeUrl(config) : github.repoHomeUrl(config)
}

/** Human-readable provider name for UI copy. */
export function providerLabel(config: RepoConfig | null): string {
  return config?.provider === 'gitlab' ? 'GitLab' : 'GitHub'
}
