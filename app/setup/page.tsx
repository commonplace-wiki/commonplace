'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * One-click GitHub App creation via GitHub's app manifest flow: this form
 * POSTs a prefilled manifest to GitHub, the user confirms once, and GitHub
 * redirects to /api/setup/callback with a code that converts into the
 * app's client id and secret.
 */
export default function SetupPage() {
  const [name, setName] = useState('Commonplace')
  const [org, setOrg] = useState('')
  const [origin, setOrigin] = useState('')
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const action = org.trim()
    ? `https://github.com/organizations/${encodeURIComponent(org.trim())}/settings/apps/new`
    : 'https://github.com/settings/apps/new'

  const manifest = JSON.stringify({
    name: name.trim() || 'Commonplace',
    url: origin,
    redirect_url: `${origin}/api/setup/callback`,
    callback_urls: [`${origin}/api/auth/callback`],
    request_oauth_on_install: false,
    public: false,
    default_permissions: { contents: 'write' },
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const state = crypto.randomUUID()
    document.cookie = `cp_setup_state=${state}; path=/; max-age=600; samesite=lax`
    const form = formRef.current!
    form.action = `${action}?state=${state}`
    form.submit()
  }

  return (
    <div className="landing">
      <h1>Set up GitHub sign-in</h1>
      <p className="subtitle">
        Creates a GitHub App for this deployment in one click: correct callback URL, Contents
        read/write permission, no webhook. You confirm on GitHub, then get the two values for your
        environment.
      </p>
      <div className="card">
        <form ref={formRef} method="post" onSubmit={submit}>
          <div className="field">
            <label>App name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
            <div className="hint">Shown on GitHub&apos;s consent screen. Must be unique on GitHub.</div>
          </div>
          <div className="field">
            <label>Organization (optional)</label>
            <input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="e.g. my-orga" />
            <div className="hint">
              Fill this in when the wiki repository belongs to an organization; the app is then
              created there instead of your personal account.
            </div>
          </div>
          <input type="hidden" name="manifest" value={manifest} />
          <button className="btn btn-primary" disabled={!origin}>
            Create GitHub App on GitHub
          </button>
        </form>
      </div>
      <p className="muted">
        Afterwards: put the shown client ID and secret into the deployment environment, restart, and
        install the app on the wiki repository.
      </p>
    </div>
  )
}
