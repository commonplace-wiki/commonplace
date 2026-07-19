import { NextResponse } from 'next/server'
import { getRepoConfig } from '@/lib/config'

export async function GET() {
  return NextResponse.json({ config: getRepoConfig() })
}
