import { NextRequest, NextResponse } from 'next/server'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function page(title: string, body: string, status = 200): NextResponse {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 640px; margin: 80px auto; padding: 0 20px; color: #1f2430; line-height: 1.55; }
  code, pre { background: #f4f5f7; border-radius: 6px; font-size: 14px; }
  code { padding: 2px 6px; }
  pre { padding: 14px 16px; overflow-x: auto; }
  a { color: #2563eb; }
  .warn { color: #9a3412; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

/**
 * Second half of the GitHub App manifest flow (see /setup): converts the
 * one-time code into the app's credentials and shows them once. Nothing is
 * stored server-side.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const expectedState = req.cookies.get('cp_setup_state')?.value

  if (!code) return page('Setup failed', '<p>GitHub did not send a code. Start again at <a href="/setup">/setup</a>.</p>', 400)
  if (!state || !expectedState || state !== expectedState) {
    return page('Setup failed', '<p>State check failed. Start again at <a href="/setup">/setup</a>.</p>', 400)
  }

  const res = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    cache: 'no-store',
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.client_id) {
    return page(
      'Setup failed',
      `<p>Converting the manifest code failed (HTTP ${res.status}). The code is single-use and expires after one hour — start again at <a href="/setup">/setup</a>.</p>`,
      502
    )
  }

  const installUrl = `${data.html_url}/installations/new`
  const body = `
<p>GitHub App <strong>${escapeHtml(data.name || data.slug)}</strong> is created. Two steps left:</p>
<p><strong>1.</strong> Put these into your environment (<code>.env.local</code> for local dev), then restart:</p>
<pre>GITHUB_CLIENT_ID=${escapeHtml(data.client_id)}
GITHUB_CLIENT_SECRET=${escapeHtml(data.client_secret)}</pre>
<p class="warn">This secret is shown only here and is not stored by Commonplace. You can generate a new one anytime in the app settings on GitHub.</p>
<p><strong>2.</strong> <a href="${escapeHtml(installUrl)}">Install the app on your wiki repository</a> (choose "Only select repositories").</p>
<p>Then open <a href="/login">the sign-in page</a>.</p>`

  const response = page('GitHub App created', body)
  response.cookies.set({ name: 'cp_setup_state', value: '', path: '/', maxAge: 0 })
  return response
}
