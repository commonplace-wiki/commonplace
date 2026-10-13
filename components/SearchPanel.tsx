'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'

const SCOPE_KEY = 'okf_search_scope'
type Scope = 'page' | 'repo'

interface Result {
  path: string
  title: string
  snippet: string
}

/** Wrap every case-insensitive occurrence of `query` in `text` with <mark>. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const parts: ReactNode[] = []
  let i = 0
  for (;;) {
    const at = lower.indexOf(q, i)
    if (at === -1) {
      parts.push(text.slice(i))
      break
    }
    if (at > i) parts.push(text.slice(i, at))
    parts.push(<mark key={at}>{text.slice(at, at + q.length)}</mark>)
    i = at + q.length
  }
  return <>{parts}</>
}

/**
 * Search overlay: full-text search over the wiki, scoped either to the current
 * page and its subpages or to the whole repository. The scope is remembered
 * per user. Opened from the top bar or with Cmd/Ctrl+K; closed with Esc.
 */
export default function SearchPanel({
  open,
  onClose,
  currentPath,
}: {
  open: boolean
  onClose: () => void
  /** Bundle path of the page being viewed ('' when there is none). */
  currentPath: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('repo')
  const [results, setResults] = useState<Result[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const hasPage = currentPath !== ''
  // "This page" only applies when a page is open; otherwise fall back to repo.
  const effectiveScope: Scope = scope === 'page' && hasPage ? 'page' : 'repo'

  // Restore the remembered scope once, on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SCOPE_KEY)
      if (saved === 'page' || saved === 'repo') setScope(saved)
    } catch {
      // storage unavailable: keep the default
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(SCOPE_KEY, scope)
    } catch {
      // ignore
    }
  }, [scope])

  // Focus the input and clear stale errors whenever the panel opens.
  useEffect(() => {
    if (open) {
      setError(null)
      inputRef.current?.focus()
    }
  }, [open])

  // Close on Esc while open.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Debounced search; an empty query never hits the network.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setResults([])
      setTruncated(false)
      setLoading(false)
      setError(null)
      return
    }
    const timer = setTimeout(() => {
      setLoading(true)
      const params = new URLSearchParams({ q, scope: effectiveScope })
      if (effectiveScope === 'page') params.set('path', currentPath)
      fetch(`/api/search?${params.toString()}`)
        .then(async (res) => {
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data.error || 'Search failed')
          setResults(Array.isArray(data.results) ? data.results : [])
          setTruncated(Boolean(data.truncated))
          setError(null)
        })
        .catch((err) => {
          setError(err.message)
          setResults([])
          setTruncated(false)
        })
        .finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [query, open, effectiveScope, currentPath])

  function go(path: string) {
    onClose()
    router.push(`/${path}`)
  }

  if (!open) return null

  const trimmed = query.trim()
  return (
    <div className="search-backdrop" onClick={onClose}>
      <div
        className="search-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="search-panel-head">
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search the wiki…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results.length > 0) go(results[0].path)
            }}
          />
          <div className="search-scope" role="group" aria-label="Search scope">
            <button
              type="button"
              className={effectiveScope === 'page' ? 'active' : ''}
              disabled={!hasPage}
              title={hasPage ? 'Search this page and its subpages' : 'Open a page to search within it'}
              onClick={() => setScope('page')}
            >
              This page
            </button>
            <button
              type="button"
              className={effectiveScope === 'repo' ? 'active' : ''}
              onClick={() => setScope('repo')}
            >
              Whole wiki
            </button>
          </div>
        </div>
        <div className="search-results">
          {loading && <p className="search-hint">Searching…</p>}
          {error && <p className="search-hint error">{error}</p>}
          {!loading && !error && trimmed && results.length === 0 && (
            <p className="search-hint">No matches.</p>
          )}
          {results.map((r) => (
            <button key={r.path} type="button" className="search-result" onClick={() => go(r.path)}>
              <span className="search-result-title">{r.title}</span>
              <span className="search-result-path">{r.path}</span>
              <span className="search-result-snippet">
                <Highlight text={r.snippet} query={trimmed} />
              </span>
            </button>
          ))}
          {truncated && <p className="search-hint">More matches exist than are shown.</p>}
        </div>
      </div>
    </div>
  )
}
