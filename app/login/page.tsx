'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { repoHomeUrl, type RepoConfig } from '@/components/Shell'

const ERROR_MESSAGES: Record<string, string> = {
  oauth_unconfigured:
    'GitHub sign-in is not configured. Create a GitHub App at /setup, or sign in with a personal access token below.',
  oauth_state: 'The OAuth state check failed. Please try signing in again.',
  oauth_exchange: 'GitHub did not return an access token. Check your OAuth app credentials.',
  oauth_user: 'Could not load your GitHub profile with the returned token.',
}

function Landing() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const errorCode = searchParams.get('error')
  // /login?token=1 skips the setup redirect and goes straight to token sign-in.
  const tokenOnly = searchParams.get('token') === '1'

  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined)
  const [config, setConfig] = useState<RepoConfig | null>(null)
  const [oauth, setOauth] = useState(true)
  const [pat, setPat] = useState('')
  const [patError, setPatError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showTokenSignIn, setShowTokenSignIn] = useState(tokenOnly)

  useEffect(() => {
    fetch('/api/me').then(async (res) => {
      if (res.ok) {
        router.replace('/')
        return
      }
      // Show which wiki this deployment serves on the sign-in screen.
      const cfg = await (await fetch('/api/config')).json().catch(() => null)
      if (cfg?.config) setConfig(cfg.config)
      // A fresh deployment without provider sign-in: walk the admin through
      // creating the app first instead of presenting a dead sign-in button.
      if (cfg && cfg.oauth === false && !tokenOnly) {
        router.replace('/setup')
        return
      }
      setOauth(cfg?.oauth !== false)
      setSignedIn(false)
    })
  }, [router, tokenOnly])

  async function signInWithPat(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setPatError(null)
    const res = await fetch('/api/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pat }),
    })
    setBusy(false)
    if (res.ok) {
      window.location.href = '/'
    } else {
      const data = await res.json().catch(() => ({}))
      setPatError(data.error || 'Sign-in failed')
    }
  }

  return (
    <div className="landing signin">
      <h1>Commonplace</h1>
      {config && (
        <p className="subtitle">
          Repository:{' '}
          <a href={repoHomeUrl(config)} target="_blank" rel="noreferrer">
            {config.owner}/{config.repo}
          </a>
          {config.branch && config.branch !== 'main' ? ` @ ${config.branch}` : ''}
          {config.root ? ` /${config.root}` : ''}
        </p>
      )}

      {errorCode && <div className="error-banner">{ERROR_MESSAGES[errorCode] || 'Sign-in failed.'}</div>}

      {signedIn === undefined && <p className="muted">Loading…</p>}

      {signedIn === false && (
        <>
          {oauth && (
            <div className="signin-actions">
              <a href="/api/auth/login" className="btn btn-primary">
                Sign in with {config?.provider === 'gitlab' ? 'GitLab' : 'GitHub'}
              </a>
            </div>
          )}
          {!oauth && (
            <p className="muted">
              {config?.provider === 'gitlab' ? 'GitLab' : 'GitHub'} sign-in is not configured for
              this deployment. <a href="/setup">Set it up</a> or use a personal access token below.
            </p>
          )}
          {!showTokenSignIn && (
            <button className="link-button muted" onClick={() => setShowTokenSignIn(true)}>
              Other sign-in options
            </button>
          )}
          {showTokenSignIn && (
            <div className="card">
              <h2>Use a personal access token</h2>
              <form onSubmit={signInWithPat}>
                <div className="field">
                  <input
                    type="password"
                    placeholder={
                      config?.provider === 'gitlab'
                        ? 'glpat-… (api scope)'
                        : 'github_pat_… (contents read/write) or ghp_… (repo scope)'
                    }
                    value={pat}
                    onChange={(e) => setPat(e.target.value)}
                    autoFocus
                  />
                </div>
                {patError && <div className="error-banner">{patError}</div>}
                <button className="btn" disabled={busy || !pat.trim()}>
                  Sign in with token
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function Page() {
  return (
    <Suspense>
      <Landing />
    </Suspense>
  )
}
