/** @type {import('next').NextConfig} */

// Sent on every response. A permissive CSP that still locks down the two
// things HTML headers can't otherwise prevent: being framed (clickjacking)
// and <object>/<embed> plugin content. Script/style sources are left to the
// app so Next.js inline hydration keeps working; the raw-asset route sets its
// own stricter, sandboxed CSP.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains',
  },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  },
]

const nextConfig = {
  // Self-contained server bundle for the Docker image.
  output: 'standalone',
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
