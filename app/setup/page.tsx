'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import EnvBlock, { type EnvVar } from '@/components/EnvBlock'
import { parseRepoUrl } from '@/lib/config'
import { HANDOFF_KEY, isLocalhost, type SetupHandoff } from './handoff'

/**
 * Neutral setup wizard: collects the wiki repository and the deployment URL,
 * creates the provider app (GitHub: one-click via the app manifest flow,
 * GitLab: guided), and emits the complete environment for the deployment.
 *
 * Works on any Commonplace instance, configured or not — including the
 * hosted docs site, for people who have not deployed anything yet. It is
 * deliberately read-only towards the server: it never changes the running
 * deployment (this page is reachable without sign-in), and the GitHub App
 * credentials are converted in the browser (see /setup/done), so they never
 * pass through this server.
 */

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export default function SetupPage() {
  const [repoUrl, setRepoUrl] = useState('')
  const [deployUrl, setDeployUrl] = useState('')
  const [name, setName] = useState('Commonplace')
  const [org, setOrg] = useState('')
  const [glId, setGlId] = useState('')
  const [glSecret, setGlSecret] = useState('')
  const [sessionSecret, setSessionSecret] = useState('')
  const [repoNote, setRepoNote] = useState<string | null>(null)
  /** Provider of the deployment's own config; parseRepoUrl alone cannot spot a self-hosted GitLab. */
  const [configProvider, setConfigProvider] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  /** Last auto-suggested app name, so typing wins over suggestions. */
  const autoName = useRef('Commonplace')

  const parsed = useMemo(() => {
    const p = parseRepoUrl(repoUrl)
    if (p) return p
    // A self-hosted GitLab host is indistinguishable from an unsupported one
    // by URL (that is what GIT_PROVIDER exists for server-side, where this
    // page cannot see it). When this deployment says it serves GitLab, treat
    // unrecognized https URLs the same way.
    if (configProvider !== 'gitlab') return null
    try {
      const url = new URL(repoUrl.trim().replace(/\.git$/, '').replace(/\/+$/, ''))
      const segments = url.pathname.split('/').filter(Boolean)
      if (segments.length < 2) return null
      return {
        provider: 'gitlab' as const,
        host: url.hostname.toLowerCase(),
        owner: segments[0],
        repo: segments.slice(1).join('/'),
      }
    } catch {
      return null
    }
  }, [repoUrl, configProvider])
  const canonicalRepoUrl = parsed
    ? parsed.provider === 'local'
      ? parsed.dir || repoUrl.trim()
      : `https://${parsed.host}/${parsed.owner}/${parsed.repo}`
    : ''
  const cleanDeploy = deployUrl.trim().replace(/\/+$/, '')

  useEffect(() => {
    // No prefills from this deployment's own configuration: this wizard also
    // runs hosted (e.g. on commonplace.wiki) for people setting up their own
    // deployment, and prefilled values from the host would read as theirs.
    // The origin is only a sensible default on localhost, where the visitor
    // is the operator of this very instance.
    if (isLocalhost(window.location.origin)) setDeployUrl(window.location.origin)
    setSessionSecret(randomHex(32))
    // The provider hint is still needed to recognize self-hosted GitLab URLs.
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        if (data?.config?.provider) setConfigProvider(data.config.provider)
      })
      .catch(() => {})
  }, [])

  // Best-effort checks against the GitHub API: repository visibility, and
  // whether the owner is an organization (personal accounts must not get the
  // org app-creation URL — it would 404). Both degrade silently, e.g. when
  // the network's anonymous API quota is exhausted.
  useEffect(() => {
    setRepoNote(null)
    if (!parsed || parsed.provider !== 'github') return
    const cancel = { done: false }
    const timer = setTimeout(() => {
      fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`)
        .then((res) => {
          if (cancel.done) return
          if (res.ok) setRepoNote('Public repository: readable without sign-in.')
          else if (res.status === 404)
            setRepoNote('Not publicly visible: private, not created yet, or a typo in the URL.')
        })
        .catch(() => {})
      fetch(`https://api.github.com/users/${encodeURIComponent(parsed.owner)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((user) => {
          if (!cancel.done && user?.type === 'Organization') setOrg((prev) => prev || parsed.owner)
        })
        .catch(() => {})
    }, 500)
    return () => {
      cancel.done = true
      clearTimeout(timer)
    }
  }, [parsed])

  const provider = parsed?.provider ?? 'github'

  // App names are globally unique on GitHub (github.com/apps/<slug>), so a
  // fixed default would collide for everyone; suggest one with the owner in
  // it, but never overwrite what the user typed themselves.
  useEffect(() => {
    if (!parsed || parsed.provider === 'local' || !parsed.owner) return
    const suggestion = `Commonplace (${parsed.owner})`.slice(0, 34)
    setName((prev) => (prev === autoName.current ? suggestion : prev))
    autoName.current = suggestion
  }, [parsed])

  const manifest = JSON.stringify({
    name: name.trim() || 'Commonplace',
    url: cleanDeploy,
    // The conversion happens in this browser on /setup/done, so the app's
    // secret never passes through whichever server hosts this wizard.
    redirect_url:
      typeof window !== 'undefined' ? `${window.location.origin}/setup/done` : '/setup/done',
    callback_urls: [`${cleanDeploy}/api/auth/callback`],
    request_oauth_on_install: false,
    public: false,
    // members (read) is what lets @-mentions list the whole organization; the
    // app degrades to repository collaborators if it is withheld.
    default_permissions: { contents: 'write', members: 'read' },
  })

  const action = org.trim()
    ? `https://github.com/organizations/${encodeURIComponent(org.trim())}/settings/apps/new`
    : 'https://github.com/settings/apps/new'

  function submitGitHub(e: React.FormEvent) {
    e.preventDefault()
    const state = crypto.randomUUID()
    const handoff: SetupHandoff = {
      state,
      repoUrl: canonicalRepoUrl,
      deployUrl: cleanDeploy,
      sessionSecret,
    }
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff))
    const form = formRef.current!
    form.action = `${action}?state=${state}`
    form.submit()
  }

  const commonFields = (
    <>
      <div className="field">
        <label>Wiki repository</label>
        <input
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          required
        />
        <div className="hint">
          {repoUrl && !parsed
            ? 'Not a supported repository URL (github.com, gitlab.com, or an absolute local path).'
            : repoNote ||
              'The repository that holds (or will hold) the wiki. GitHub, GitLab, or an absolute local path.'}
        </div>
      </div>
      {provider !== 'local' && (
        <div className="field">
          <label>Deployment URL</label>
          <input
            type="url"
            value={deployUrl}
            onChange={(e) => setDeployUrl(e.target.value)}
            required
          />
          <div className="hint">
            Where this Commonplace deployment runs (or will run), as users reach it. Sign-in
            redirects back to this URL.
          </div>
        </div>
      )}
    </>
  )

  const sharedEnv: EnvVar[] = [
    { key: 'GIT_REPO', value: canonicalRepoUrl || '…' },
    { key: 'SESSION_SECRET', value: sessionSecret || '…' },
    ...(cleanDeploy && !isLocalhost(cleanDeploy)
      ? [{ key: 'PUBLIC_ORIGIN', value: cleanDeploy }]
      : []),
  ]

  if (provider === 'local') {
    return (
      <div className="landing">
        <h1>Set up Commonplace</h1>
        <p className="subtitle">
          A local repository path needs no sign-in setup: the wiki reads and commits directly on
          disk.
        </p>
        <div className="card">
          {commonFields}
          <EnvBlock
            vars={[{ key: 'GIT_REPO', value: canonicalRepoUrl || '…' }]}
          />
          <p className="muted">
            In Docker, mount the folder and point <code>GIT_REPO</code> at the mount path, e.g.{' '}
            <code>-v /path/to/wiki:/wiki -e GIT_REPO=/wiki</code>.
          </p>
        </div>
      </div>
    )
  }

  if (provider === 'gitlab') {
    const host = parsed?.host || 'gitlab.com'
    return (
      <div className="landing">
        <h1>Set up GitLab sign-in</h1>
        <p className="subtitle">
          GitLab has no one-click app creation, so this takes one manual step: create an OAuth
          application, then paste its credentials here to get the complete environment.
        </p>
        <div className="card">
          {commonFields}
          <ol style={{ margin: '0 0 16px', paddingLeft: 20, display: 'grid', gap: 8 }}>
            <li>
              Open{' '}
              <a href={`https://${host}/-/user_settings/applications`} target="_blank" rel="noreferrer">
                https://{host}/-/user_settings/applications
              </a>{' '}
              (or a group-owned application under the group settings).
            </li>
            <li>
              Redirect URI: <code>{cleanDeploy || '…'}/api/auth/callback</code>
            </li>
            <li>
              Check <strong>Confidential</strong> and select the <code>api</code> scope.
            </li>
          </ol>
          <div className="field">
            <label>Application ID</label>
            <input value={glId} onChange={(e) => setGlId(e.target.value)} />
          </div>
          <div className="field">
            <label>Secret</label>
            <input value={glSecret} onChange={(e) => setGlSecret(e.target.value)} />
          </div>
          <EnvBlock
            vars={[
              ...sharedEnv,
              { key: 'GITLAB_CLIENT_ID', value: glId || '…' },
              { key: 'GITLAB_CLIENT_SECRET', value: glSecret || '…' },
              ...(host !== 'gitlab.com' ? [{ key: 'GIT_PROVIDER', value: 'gitlab' }] : []),
            ]}
          />
          <p className="muted">
            Set the environment, restart, and sign in. Editing requires at least the Developer role
            on the project.
          </p>
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
      <h1>Set up Commonplace</h1>
      <p className="subtitle">
        Creates a GitHub App for your deployment in one click: correct callback URL, Contents
        read/write permission, no webhook. You confirm on GitHub, then get the complete environment
        for your deployment. Nothing is stored on this server.
      </p>
      <div className="card">
        <form ref={formRef} method="post" onSubmit={submitGitHub}>
          {commonFields}
          <div className="field">
            <label>App name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
            <div className="hint">
              Shown on GitHub&apos;s consent screen. App names are unique across all of GitHub, so
              a personal touch is required.
            </div>
          </div>
          <input type="hidden" name="manifest" value={manifest} />
          <button className="btn btn-primary" disabled={!deployUrl || !parsed}>
            Create GitHub App on GitHub
          </button>
        </form>
      </div>
      <p className="muted">
        Alternatively, <a href="/login?token=1">sign in with a personal access token</a>, no app
        needed.
      </p>
    </div>
  )
}
