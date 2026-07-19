import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }
  return NextResponse.json({
    login: session.login,
    avatarUrl: session.avatarUrl,
    authMethod: session.authMethod,
  })
}
