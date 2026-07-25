'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useRef, useState } from 'react'
import EnvBlock from '@/components/EnvBlock'
import { HANDOFF_KEY, isLocalhost, type SetupHandoff } from '../handoff'

interface Conversion {
  name?: string
  slug?: string
  html_url: string
  client_id: string
  client_secret: string
}

/**
 * Second half of the GitHub App manifest flow: GitHub redirects here with a
 * one-time code, which this page converts into the app's credentials — in
 * the browser, against api.github.com directly, so the secret never touches
 * the server hosting the wizard. Combined with what /setup stowed in
 * sessionStorage, this renders the deployment's complete environment.
 */
function Done() {
  const searchParams = useSearchParams()
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const [handoff, setHandoff] = useState<SetupHandoff | null>(null)
  const [result, setResult] = useState<Conversion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    let stored: SetupHandoff | null = null
    try {
      stored = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || 'null')
    } catch {
      // treated as missing
    }
    if (!code) {
      setError('GitHub did not send a code.')
      return
    }
    if (!stored || !state || stored.state !== state) {
      setError('The state check failed (was the wizard started in another browser or tab?).')
      return
    }
    setHandoff(stored)
    fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.client_id) {
          throw new Error(`HTTP ${res.status}${data?.message ? `: ${data.message}` : ''}`)
        }
        setResult(data as Conversion)
        sessionStorage.removeItem(HANDOFF_KEY)
      })
      .catch((err) => {
        setError(
          `Converting the manifest code failed (${err instanceof Error ? err.message : err}). ` +
            'The code is single-use and expires after one hour.'
        )
      })
  }, [code, state])

  if (error) {
    return (
      <div className="landing">
        <h1>Setup failed</h1>
        <div className="error-banner">{error}</div>
        <p>
          <Link href="/setup">Start again at /setup</Link>
        </p>
      </div>
    )
  }
  if (!result || !handoff) {
    return (
      <div className="landing">
        <h1>Finishing setup…</h1>
        <p className="muted">Converting the GitHub App credentials in your browser.</p>
      </div>
    )
  }

  const installUrl = `${result.html_url}/installations/new`
  return (
    <div className="landing">
      <h1>GitHub App created</h1>
      <p className="subtitle">
        <strong>{result.name || result.slug}</strong> is ready. Two steps left.
      </p>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          <strong>1.</strong>{' '}
          <a href={installUrl} target="_blank" rel="noreferrer">
            Install the app on the wiki repository
          </a>{' '}
          (choose &quot;Only select repositories&quot;).
        </p>
        <p>
          <strong>2.</strong> Start your deployment with this environment:
        </p>
        <EnvBlock
          vars={[
            { key: 'GIT_REPO', value: handoff.repoUrl },
            { key: 'GITHUB_CLIENT_ID', value: result.client_id },
            { key: 'GITHUB_CLIENT_SECRET', value: result.client_secret },
            { key: 'SESSION_SECRET', value: handoff.sessionSecret },
            ...(handoff.deployUrl && !isLocalhost(handoff.deployUrl)
              ? [{ key: 'PUBLIC_ORIGIN', value: handoff.deployUrl }]
              : []),
          ]}
        />
        <p className="muted" style={{ marginBottom: 0 }}>
          The client secret is shown only here; it was converted in your browser and is not stored
          anywhere by Commonplace. You can generate a new one anytime in the app settings on
          GitHub.
        </p>
      </div>
      <p>
        Then open{' '}
        <a href={handoff.deployUrl || '/'} rel="noreferrer">
          {handoff.deployUrl || 'your deployment'}
        </a>{' '}
        and sign in.
      </p>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense>
      <Done />
    </Suspense>
  )
}
