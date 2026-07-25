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
  const [provider, setProvider] = useState<'github' | 'gitlab'>('github')
  const [host, setHost] = useState('gitlab.com')
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        if (data?.config?.provider === 'gitlab') {
          setProvider('gitlab')
          setHost(data.config.host)
          return
        }
        // Prefill the organization from the wiki repository's owner — but
        // only when that owner really is an organization: for a personal
        // account, GitHub's org app-creation URL would 404. The public users
        // API tells them apart and allows anonymous browser requests.
        const owner = data?.config?.owner
        if (data?.config?.provider === 'github' && owner) {
          fetch(`https://api.github.com/users/${encodeURIComponent(owner)}`)
            .then((res) => (res.ok ? res.json() : null))
            .then((user) => {
              if (user?.type === 'Organization') setOrg((prev) => prev || owner)
            })
            .catch(() => {})
        }
      })
      .catch(() => {})
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
    // members (read) is what lets @-mentions list the whole organization; the
    // app degrades to repository collaborators if it is withheld.
    default_permissions: { contents: 'write', members: 'read' },
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const state = crypto.randomUUID()
    document.cookie = `cp_setup_state=${state}; path=/; max-age=600; samesite=lax`
    const form = formRef.current!
    form.action = `${action}?state=${state}`
    form.submit()
  }

  if (provider === 'gitlab') {
    return (
      <div className="landing">
        <h1>Set up GitLab sign-in</h1>
        <p className="subtitle">
          Create an OAuth application on your GitLab instance and put its credentials into the
          deployment environment.
        </p>
        <div className="card">
          <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8 }}>
            <li>
              Open{' '}
              <a href={`https://${host}/-/user_settings/applications`} target="_blank" rel="noreferrer">
                https://{host}/-/user_settings/applications
              </a>{' '}
              (or a group-owned application under the group settings).
            </li>
            <li>
              Redirect URI: <code>{origin}/api/auth/callback</code>
            </li>
            <li>
              Check <strong>Confidential</strong> and select the <code>api</code> scope.
            </li>
            <li>
              Put the shown Application ID and Secret into the environment and restart:
              <pre style={{ marginTop: 8 }}>
                GITLAB_CLIENT_ID=…{'\n'}GITLAB_CLIENT_SECRET=…
              </pre>
            </li>
          </ol>
        </div>
        <p className="muted">
          Alternatively, <a href="/login?token=1">sign in with a personal access token</a> (
          <code>api</code> scope), no application needed.
        </p>
      </div>
    )
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
      <p className="muted">
        Alternatively, <a href="/login?token=1">sign in with a personal access token</a>, no app
        needed.
      </p>
    </div>
  )
}
