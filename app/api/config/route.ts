import { NextResponse } from 'next/server'
import { getRepoConfig } from '@/lib/config'

export async function GET() {
  const config = getRepoConfig()
  // Whether provider sign-in (OAuth) is configured. Only a boolean leaves the
  // server; the login page walks the admin through /setup when it is false.
  // Local repositories need no credentials: sign-in always works.
  const oauth =
    config?.provider === 'local'
      ? true
      : config?.provider === 'gitlab'
        ? Boolean(process.env.GITLAB_CLIENT_ID)
        : Boolean(process.env.GITHUB_CLIENT_ID)
  // The server-side directory path stays on the server.
  const publicConfig = config ? { ...config, dir: undefined } : null
  return NextResponse.json({ config: publicConfig, oauth })
}
