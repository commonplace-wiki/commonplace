import type { NextRequest } from 'next/server'

/**
 * Public origin of the deployment as the client sees it. Behind a reverse
 * proxy (Azure Container Apps, nginx, ...) `req.url` carries the internal
 * listen address (e.g. 0.0.0.0:3000), so fall back to the forwarded
 * host/protocol headers the proxy sets.
 *
 * The forwarded headers are client-controllable unless the proxy overwrites
 * them, so a spoofed `X-Forwarded-Host` would otherwise flow into OAuth
 * redirect URIs and other absolute links. Set PUBLIC_ORIGIN to the real
 * external origin (e.g. https://wiki.example.com) to pin it and ignore the
 * headers entirely.
 */
export function publicOrigin(req: NextRequest): string {
  const configured = process.env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, '')
  if (configured) return configured
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  if (!host) return new URL(req.url).origin
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() || 'http'
  return `${proto}://${host}`
}

/** Absolute URL for an app path, based on the public origin. */
export function publicUrl(path: string, req: NextRequest): URL {
  return new URL(path, publicOrigin(req))
}
