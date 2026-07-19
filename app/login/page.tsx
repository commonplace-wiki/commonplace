'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'

interface Repo {
  fullName: string
  owner: string
  name: string
  defaultBranch: string
  private: boolean
  description: string | null
}

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

  const [me, setMe] = useState<{ login: string } | null | undefined>(undefined)
  const [config, setConfig] = useState<{ owner: string; repo: string; branch: string; root: string } | null>(null)
  const [repos, setRepos] = useState<Repo[] | null>(null)
  const [repoError, setRepoError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Repo | null>(null)
  const [owner, setOwner] = useState('')
  const [repoName, setRepoName] = useState('')
  const [branch, setBranch] = useState('main')
  const [root, setRoot] = useState('')
  const [pat, setPat] = useState('')
  const [patError, setPatError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showTokenSignIn, setShowTokenSignIn] = useState(false)

  useEffect(() => {
    fetch('/api/me').then(async (res) => {
      if (res.ok) {
        const cfg = await (await fetch('/api/config')).json()
        if (cfg.fixed && cfg.config) {
          // Deployment-pinned repository: no picker, go straight to the wiki.
          router.replace('/')
          return
        }
        setMe(await res.json())
        if (cfg.config) {
          setConfig(cfg.config)
          setOwner(cfg.config.owner)
          setRepoName(cfg.config.repo)
          setBranch(cfg.config.branch)
          setRoot(cfg.config.root)
        }
        const repoRes = await fetch('/api/repos')
        const repoData = await repoRes.json()
        if (repoRes.ok) setRepos(repoData.repos)
        else setRepoError(repoData.error || 'Could not list repositories')
      } else {
        setMe(null)
        // Show which wiki this deployment serves on the sign-in screen.
        const cfg = await (await fetch('/api/config')).json().catch(() => null)
        if (cfg?.config) setConfig(cfg.config)
      }
    })
  }, [router])

  const filteredRepos = useMemo(() => {
    if (!repos) return []
    const q = filter.toLowerCase()
    return repos.filter((r) => r.fullName.toLowerCase().includes(q)).slice(0, 50)
  }, [repos, filter])

  function pickRepo(repo: Repo) {
    setSelected(repo)
    setOwner(repo.owner)
    setRepoName(repo.name)
    setBranch(repo.defaultBranch)
  }

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

  async function openWiki(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner, repo: repoName, branch, root }),
    })
    setBusy(false)
    if (res.ok) router.push('/')
  }

  return (
    <div className={`landing${me === null ? ' signin' : ''}`}>
      <h1>Commonplace</h1>
      {me === null && config && (
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

      {me === undefined && <p className="muted">Loading…</p>}

      {me === null && (
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

      {me && (
        <>
          <p className="muted">
            Signed in as <strong>{me.login}</strong>.{' '}
            {config && (
              <>
                Current wiki: <strong>{config.owner}/{config.repo}</strong> @ {config.branch}
                {config.root ? ` /${config.root}` : ''} — <a href="/">open it</a>.
              </>
            )}
          </p>
          <div className="card">
            <h2>Choose a knowledge repository</h2>
            <input
              className="search-box"
              placeholder="Filter repositories…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {repoError && <div className="error-banner">{repoError}</div>}
            {repos === null && !repoError && <p className="muted">Loading repositories…</p>}
            {repos && (
              <div className="repo-list">
                {filteredRepos.map((repo) => (
                  <button
                    key={repo.fullName}
                    className={`repo-item${selected?.fullName === repo.fullName ? ' selected' : ''}`}
                    onClick={() => pickRepo(repo)}
                  >
                    <div className="name">
                      {repo.fullName} {repo.private ? '🔒' : ''}
                    </div>
                    {repo.description && <div className="desc">{repo.description}</div>}
                  </button>
                ))}
                {filteredRepos.length === 0 && <div className="repo-item">No repositories match.</div>}
              </div>
            )}
            <form onSubmit={openWiki} style={{ marginTop: 16 }}>
              <div className="fm-grid">
                <div className="field">
                  <label>Owner</label>
                  <input value={owner} onChange={(e) => setOwner(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Repository</label>
                  <input value={repoName} onChange={(e) => setRepoName(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Branch</label>
                  <input value={branch} onChange={(e) => setBranch(e.target.value)} required />
                </div>
                <div className="field">
                  <label>Bundle root (optional subdirectory)</label>
                  <input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="e.g. docs/knowledge" />
                </div>
              </div>
              <button className="btn btn-primary" disabled={busy || !owner || !repoName}>
                Open wiki
              </button>
            </form>
          </div>
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
