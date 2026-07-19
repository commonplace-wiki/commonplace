import { NextResponse } from 'next/server'
import { clearedSessionCookie } from '@/lib/session'
import { clearedConfigCookie } from '@/lib/config'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(clearedSessionCookie())
  res.cookies.set(clearedConfigCookie())
  return res
}
