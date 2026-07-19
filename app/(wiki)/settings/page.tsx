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
  const { refreshSettings, config, fixedConfig } = useWiki()
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [sha, setSha] = useState<string | null>(null)
  const [exists, setExists] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      <h1 className="page-title">Wiki settings</h1>
      <p className="muted">
        Repository:{' '}
        <strong>
          {config ? `${config.owner}/${config.repo} @ ${config.branch}${config.root ? ` /${config.root}` : ''}` : '…'}
        </strong>
        {fixedConfig ? ' (fixed by the deployment via WIKI_REPO)' : <> — <a href="/login">change</a></>}
        <br />
        Settings are stored as <code>.wiki/settings.yaml</code> in the repository, so they are versioned
        and shared by everyone using this wiki. A <code>.wiki/logo.svg</code> or{' '}
        <code>.wiki/logo.png</code> is shown in the top bar.
      </p>
      {!exists && <div className="notice">No settings file yet; saving creates it.</div>}
      {message && <div className="notice">{message}</div>}
      {error && <div className="error-banner">{error}</div>}
      <form onSubmit={save}>
        <div className="field">
          <label>Wiki name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Acme Wiki"
          />
          <div className="hint">Shown in the top bar, the browser tab, and as the home page title.</div>
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
