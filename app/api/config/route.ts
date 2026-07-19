import { NextResponse } from 'next/server'
import { getRepoConfig } from '@/lib/config'

export async function GET() {
  const config = getRepoConfig()
  // Whether provider sign-in (OAuth) is configured. Only a boolean leaves the
  // server; the login page walks the admin through /setup when it is false.
  const oauth =
    config?.provider === 'gitlab'
      ? Boolean(process.env.GITLAB_CLIENT_ID)
      : Boolean(process.env.GITHUB_CLIENT_ID)
  return NextResponse.json({ config, oauth })
}
