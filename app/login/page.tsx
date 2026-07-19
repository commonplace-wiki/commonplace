'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

const ERROR_MESSAGES: Record<string, string> = {
  oauth_unconfigured:
    'GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in .env.local, or sign in with a personal access token below.',
  oauth_state: 'The OAuth state check failed. Please try signing in again.',
  oauth_exchange: 'GitHub did not return an access token. Check your OAuth app credentials.',
  oauth_user: 'Could not load your GitHub profile with the returned token.',
}

function Landing() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const errorCode = searchParams.get('error')

  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined)
  const [config, setConfig] = useState<{ owner: string; repo: string; branch: string; root: string } | null>(null)
  const [pat, setPat] = useState('')
  const [patError, setPatError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showTokenSignIn, setShowTokenSignIn] = useState(false)

  useEffect(() => {
    fetch('/api/me').then(async (res) => {
      if (res.ok) {
        router.replace('/')
        return
      }
      setSignedIn(false)
      // Show which wiki this deployment serves on the sign-in screen.
      const cfg = await (await fetch('/api/config')).json().catch(() => null)
      if (cfg?.config) setConfig(cfg.config)
    })
  }, [router])

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
          Wiki:{' '}
          <a href={`https://github.com/${config.owner}/${config.repo}`} target="_blank" rel="noreferrer">
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
          <div className="signin-actions">
            <a href="/api/auth/login" className="btn btn-primary">
              Sign in with GitHub
            </a>
          </div>
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
                    placeholder="github_pat_… (contents read/write) or ghp_… (repo scope)"
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
