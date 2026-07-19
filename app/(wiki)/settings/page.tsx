'use client'

import { useEffect, useState } from 'react'
import { useWiki } from '@/components/Shell'

interface SettingsForm {
  name: string
  description: string
  default_type: string
  update_log: boolean
}

export default function SettingsPage() {
  const { refreshSettings, refreshTree, config, logo } = useWiki()
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [sha, setSha] = useState<string | null>(null)
  const [exists, setExists] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)
  /** Local override so the preview updates before the tree refresh lands. */
  const [logoOverride, setLogoOverride] = useState<string | null | undefined>(undefined)

  const currentLogo = logoOverride === undefined ? logo : logoOverride

  async function uploadLogo(file: File) {
    const ext = file.name.toLowerCase().endsWith('.svg') || file.type === 'image/svg+xml' ? 'svg' : 'png'
    if (ext === 'png' && !(file.name.toLowerCase().endsWith('.png') || file.type === 'image/png')) {
      setError('Logo must be an SVG or PNG file')
      return
    }
    setLogoBusy(true)
    setError(null)
    setMessage(null)
    const buf = await file.arrayBuffer()
    let binary = ''
    for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte)
    const res = await fetch('/api/settings/logo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ext, content: btoa(binary) }),
    })
    const data = await res.json().catch(() => ({}))
    setLogoBusy(false)
    if (res.ok) {
      setLogoOverride(data.path)
      setMessage('Logo committed to the repository.')
      refreshTree()
    } else {
      setError(data.error || 'Logo upload failed')
    }
  }

  async function removeLogo() {
    setLogoBusy(true)
    setError(null)
    setMessage(null)
    const res = await fetch('/api/settings/logo', { method: 'DELETE' })
    setLogoBusy(false)
    if (res.ok) {
      setLogoOverride(null)
      setMessage('Logo removed.')
      refreshTree()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Logo removal failed')
    }
  }

  useEffect(() => {
    fetch('/api/settings').then(async (res) => {
      const data = await res.json()
      if (res.ok) {
        setForm(data.settings)
        setSha(data.sha)
        setExists(data.exists)
      } else {
        setError(data.error || 'Could not load settings')
      }
    })
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setSaving(true)
    setError(null)
    setMessage(null)
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: form, sha }),
    })
    const data = await res.json().catch(() => ({}))
    setSaving(false)
    if (res.ok) {
      setSha(data.sha)
      setExists(true)
      setMessage('Settings committed to the repository.')
      refreshSettings()
    } else {
      setError(data.error || 'Save failed')
    }
  }

  if (!form) return <p className="muted">{error || 'Loading settings…'}</p>

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 className="page-title">Settings</h1>
      <p className="muted">
        Repository:{' '}
        <strong>
          {config ? `${config.owner}/${config.repo} @ ${config.branch}${config.root ? ` /${config.root}` : ''}` : '…'}
        </strong>
        {' (set by the deployment via GIT_REPO)'}
        <br />
        Settings are stored as <code>.commonplace/settings.yaml</code> in the repository, so they are versioned
        and shared by everyone using this wiki. A <code>.commonplace/logo.svg</code> or{' '}
        <code>.commonplace/logo.png</code> is shown in the top bar.
      </p>
      {!exists && <div className="notice">No settings file yet; saving creates it.</div>}
      {message && <div className="notice">{message}</div>}
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={save}>
        <div className="field">
          <label>Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Acme Wiki"
          />
          <div className="hint">Shown in the top bar, the browser tab, and as the home page title.</div>
        </div>
        <div className="field">
          <label>Logo</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {currentLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/raw?path=${encodeURIComponent(currentLogo)}`}
                alt="Wiki logo"
                style={{ height: 32, maxWidth: 160, objectFit: 'contain' }}
              />
            )}
            <input
              type="file"
              accept=".svg,.png,image/svg+xml,image/png"
              disabled={logoBusy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) uploadLogo(file)
                e.target.value = ''
              }}
              style={{ width: 'auto' }}
            />
            {currentLogo && (
              <button type="button" className="btn" onClick={removeLogo} disabled={logoBusy}>
                {logoBusy ? 'Working…' : 'Remove'}
              </button>
            )}
          </div>
          <div className="hint">
            SVG or PNG, up to 1 MB; committed as <code>.commonplace/logo.svg</code> (or <code>.png</code>) and
            shown in the top bar.
          </div>
        </div>
        <div className="field">
          <label>Description</label>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="One line about what this wiki holds"
          />
        </div>
        <div className="field">
          <label>Default concept type for new pages</label>
          <input
            value={form.default_type}
            onChange={(e) => setForm({ ...form, default_type: e.target.value })}
            placeholder="Wiki Page"
          />
          <div className="hint">Prefills the OKF “type” field when creating a page.</div>
        </div>
        <div className="field">
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600 }}>
            <input
              type="checkbox"
              checked={form.update_log}
              onChange={(e) => setForm({ ...form, update_log: e.target.checked })}
              style={{ width: 'auto' }}
            />
            Record page changes in log.md by default
          </label>
        </div>
        <button className="btn btn-primary" disabled={saving}>
          {saving ? 'Committing…' : 'Save settings'}
        </button>
      </form>
    </div>
  )
}
