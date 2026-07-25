/**
 * What the setup wizard stows in sessionStorage before the round-trip
 * through GitHub, and /setup/done picks back up.
 */
export interface SetupHandoff {
  state: string
  repoUrl: string
  deployUrl: string
  sessionSecret: string
}

export const HANDOFF_KEY = 'cp_setup'

/** DEPLOYMENT_URL matters wherever a proxy might sit; skip it only for localhost. */
export function isLocalhost(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}
