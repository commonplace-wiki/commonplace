'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { clearCachedPages } from '@/lib/pageCache'
import Sidebar from './Sidebar'

export interface Me {
  login: string
  avatarUrl: string
  /** Profile page on the wiki's hosting provider. */
  profileUrl?: string
  /**
   * Whether the token can push to the wiki repo. Absent until /api/me/access
   * answers, and null when that lookup could not determine it — consumers
   * must treat anything other than `false` as allowed.
   */
  canWrite?: boolean | null
}

export interface RepoConfig {
  provider: 'github' | 'gitlab' | 'local'
  host: string
  owner: string
  repo: string
  branch: string
  root: string
}

/** Home page of the wiki repository on its hosting provider; null for a local repo. */
export function repoHomeUrl(config: RepoConfig): string | null {
  if (config.provider === 'local') return null
  return `https://${config.host}/${config.owner}/${config.repo}`
}

/** "owner/repo", or just the directory name for a local repository. */
export function repoLabel(config: RepoConfig): string {
  return config.owner ? `${config.owner}/${config.repo}` : config.repo
}

/** The repository name, linked to its host when it has one. */
export function RepoLink({ config }: { config: RepoConfig }) {
  const url = repoHomeUrl(config)
  if (!url) return <>{repoLabel(config)}</>
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {repoLabel(config)}
    </a>
  )
}

export interface WikiFile {
  path: string
  title: string | null
  /** Tagged "hidden" in frontmatter: kept out of nav and listings. */
  hidden?: boolean
}

export interface WikiSettings {
  name: string
  description: string
  default_type: string
  update_log: boolean
}

interface WikiContextValue {
  me: Me | null
  config: RepoConfig | null
  /** Every .md file of the bundle with its frontmatter title. Null while loading. */
  files: WikiFile[] | null
  /** Sidebar sort order from .commonplace/order.yaml: directory path → child names. */
  order: Record<string, string[]>
  treeError: string | null
  settings: WikiSettings | null
  /** Bundle path of the wiki logo (.commonplace/logo.svg or .png), if any. */
  logo: string | null
  /** Refetches the tree; the returned promise resolves with the first fetch. */
  refreshTree: () => Promise<void>
  refreshSettings: () => void
}

const WikiContext = createContext<WikiContextValue>({
  me: null,
  config: null,
  files: null,
  order: {},
  treeError: null,
  settings: null,
  logo: null,
  refreshTree: async () => {},
  refreshSettings: () => {},
})

export function useWiki() {
  return useContext(WikiContext)
}

function UserMenu({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="user-menu-wrap" ref={wrapRef}>
      <button className="avatar-btn" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={me.avatarUrl} alt={me.login} className="avatar" />
      </button>
      {open && (
        <div className="user-menu" role="menu">
          <div className="user-menu-header">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={me.avatarUrl} alt="" className="avatar" />
            <span>{me.login}</span>
          </div>
          <div className="user-menu-sep" />
          <Link href="/settings" className="user-menu-item" onClick={() => setOpen(false)}>
            Settings
          </Link>
          <Link href="/mcp" className="user-menu-item" onClick={() => setOpen(false)}>
            MCP
          </Link>
          {me.profileUrl && (
            <a href={me.profileUrl} target="_blank" rel="noreferrer" className="user-menu-item">
              Profile
            </a>
          )}
          <div className="user-menu-sep" />
          <button className="user-menu-item" onClick={onLogout}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * First-run screen for a deployment without GIT_REPO. Without it, the main
 * area would sit on a loading state forever with the actual problem tucked
 * into a sidebar error line.
 */
function Unconfigured() {
  return (
    <div className="landing">
      <h1>Welcome to Commonplace</h1>
      <p className="subtitle">
        One thing is missing: the Git repository that holds (or will hold) your wiki.
      </p>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Set <code>GIT_REPO</code> in the environment and restart, e.g.
        </p>
        <pre>
          {'docker run -p 3000:3000 \\\n' +
            '  -e GIT_REPO=https://github.com/owner/repo \\\n' +
            '  commonplacewiki/commonplace'}
        </pre>
        <p className="muted" style={{ marginBottom: 0 }}>
          Public and private repositories on github.com or GitLab work, as does an absolute path to
          a local folder. A public repository is readable immediately; sign-in for editing is set up
          afterwards under <code>/setup</code>.
        </p>
      </div>
      <p className="muted">
        <a href="https://www.commonplace.wiki/getting-started.md" target="_blank" rel="noreferrer">
          Getting started guide
        </a>
      </p>
    </div>
  )
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  // While editing, Save should be the only primary action on screen.
  const isEditing = pathname.startsWith('/edit/')
  // "+ New page" creates in the directory the user is currently looking at.
  const currentDir = (() => {
    const p = decodeURIComponent(pathname).replace(/^\/+/, '')
    if (!p || p === 'settings' || p === 'mcp' || p === 'login' || p.startsWith('edit/') || p.startsWith('wiki/')) return ''
    if (p.endsWith('.md')) return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
    return p
  })()
  const [me, setMe] = useState<Me | null>(null)
  /** True when /api/config reported that GIT_REPO is not set at all. */
  const [unconfigured, setUnconfigured] = useState(false)
  // Mobile nav drawer: hidden on wide screens, slides in over the content
  // when the topbar hamburger is tapped.
  const [navOpen, setNavOpen] = useState(false)
  /** True once /api/me answered: me === null then means anonymous viewer. */
  const [authResolved, setAuthResolved] = useState(false)
  const [config, setConfig] = useState<RepoConfig | null>(null)
  const [files, setFiles] = useState<WikiFile[] | null>(null)
  const [order, setOrder] = useState<Record<string, string[]>>({})
  const [treeError, setTreeError] = useState<string | null>(null)
  const [settings, setSettings] = useState<WikiSettings | null>(null)
  const [logo, setLogo] = useState<string | null>(null)
  // Monotonic id so an older, slower /api/tree response never overwrites a newer one.
  const treeRequestRef = useRef(0)

  const refreshSettings = useCallback(() => {
    fetch('/api/settings')
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        setSettings(data.settings)
        try {
          sessionStorage.setItem('okf_settings', JSON.stringify(data.settings))
        } catch {
          // cache is best-effort
        }
      })
      .catch(() => {})
  }, [])

  const fetchTree = useCallback(() => {
    const requestId = ++treeRequestRef.current
    return fetch('/api/tree')
      .then(async (res) => {
        const data = await res.json()
        // A newer request is in flight or already landed; drop this response.
        if (requestId !== treeRequestRef.current) return
        if (res.status === 401) {
          // No session and the repo is not publicly readable.
          router.replace('/login')
          return
        }
        if (!res.ok) throw new Error(data.error || 'Failed to load tree')
        setFiles(data.files)
        setLogo(data.logo || null)
        setOrder(data.order || {})
        setTreeError(null)
        try {
          sessionStorage.setItem(
            'okf_tree',
            JSON.stringify({ files: data.files, logo: data.logo || null, order: data.order || {} })
          )
        } catch {
          // cache is best-effort
        }
      })
      .catch((err) => {
        if (requestId === treeRequestRef.current) setTreeError(err.message)
      })
  }, [router])

  // Called after a page is added, renamed, moved, or deleted. GitHub's tree
  // read can lag the write, so refresh now and again shortly after until the
  // sidebar reflects the change.
  const refreshTree = useCallback(() => {
    const first = fetchTree()
    setTimeout(fetchTree, 1500)
    setTimeout(fetchTree, 4000)
    return first
  }, [fetchTree])

  useEffect(() => {
    let cancelled = false
    // Paint cached tree, logo, and settings instantly; fresh data replaces them.
    try {
      const cached = sessionStorage.getItem('okf_tree')
      if (cached) {
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed)) setFiles(parsed) // legacy cache shape
        else {
          setFiles(parsed.files)
          setLogo(parsed.logo || null)
          setOrder(parsed.order || {})
        }
      }
      const cachedSettings = sessionStorage.getItem('okf_settings')
      if (cachedSettings) setSettings(JSON.parse(cachedSettings))
    } catch {
      // ignore broken cache
    }
    fetchTree()
    refreshSettings()
    async function boot() {
      const [meRes, cfgRes] = await Promise.all([fetch('/api/me'), fetch('/api/config')])
      if (cancelled) return
      const cfgData = await cfgRes.json()
      if (!cfgData.config) {
        setTreeError('No wiki repository configured.')
        setUnconfigured(true)
        setAuthResolved(true)
        return
      }
      if (meRes.status === 401) {
        // Anonymous viewer: reads work on public repos, editing needs sign-in.
        // If the repo turns out to be private, the tree request 401s and
        // redirects to /login from there.
        setConfig(cfgData.config)
        setAuthResolved(true)
        return
      }
      const meData = await meRes.json()
      setMe(meData)
      setConfig(cfgData.config)
      setAuthResolved(true)
      // Write access is a separate, slower question than identity, and only
      // drives the warning banner and drag-to-reorder — both of which treat
      // "undetermined" as permissive. Fetching it after the shell has painted
      // keeps a slow provider lookup off the critical path.
      fetch('/api/me/access')
        .then((res) => (res.ok ? res.json() : null))
        .then((access) => {
          if (cancelled || !access) return
          setMe((prev) => (prev ? { ...prev, canWrite: access.canWrite } : prev))
        })
        .catch(() => {
          // Undetermined access stays permissive; a real save still fails loudly.
        })
    }
    boot()
    return () => {
      cancelled = true
    }
  }, [router, fetchTree, refreshSettings])

  // Close the mobile drawer whenever the route changes (a nav link was tapped).
  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  // Resizable sidebar: width lives in the --sidebar-w CSS variable and persists.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('okf_sidebar_w')
      if (saved) document.documentElement.style.setProperty('--sidebar-w', `${saved}px`)
    } catch {
      // ignore
    }
  }, [])

  function startSidebarResize(e: React.MouseEvent) {
    e.preventDefault()
    const clamp = (x: number) => Math.min(560, Math.max(200, x))
    const onMove = (ev: MouseEvent) => {
      document.documentElement.style.setProperty('--sidebar-w', `${clamp(ev.clientX)}px`)
    }
    const onUp = (ev: MouseEvent) => {
      try {
        localStorage.setItem('okf_sidebar_w', String(clamp(ev.clientX)))
      } catch {
        // ignore
      }
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.classList.remove('sidebar-resizing')
    }
    document.body.classList.add('sidebar-resizing')
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  async function logout() {
    try {
      sessionStorage.removeItem('okf_tree')
      sessionStorage.removeItem('okf_settings')
    } catch {
      // ignore
    }
    // Cached page bodies are repo content: they must not outlive the session.
    clearCachedPages()
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  return (
    <WikiContext.Provider
      value={{ me, config, files, order, treeError, settings, logo, refreshTree, refreshSettings }}
    >
      <header className="topbar">
        <button
          className="nav-toggle"
          onClick={() => setNavOpen((v) => !v)}
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          aria-controls="wiki-sidebar"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <Link href="/" className="brand">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/raw?path=${encodeURIComponent(logo)}`} alt="" className="brand-logo" />
          ) : (
            <span className="brand-mark">C</span>
          )}
          {settings === null ? ' ' : settings.name || 'Commonplace'}
        </Link>
        <div className="topbar-spacer" />
        {!isEditing && me && (
          <Link
            href={`/edit/__new__${currentDir ? `?dir=${encodeURIComponent(currentDir)}` : ''}`}
            className="btn btn-primary"
          >
            + New page
          </Link>
        )}
        {authResolved && !me && (
          <Link href="/login" className="btn btn-primary">
            Sign in
          </Link>
        )}
        {me && <UserMenu me={me} onLogout={logout} />}
      </header>
      <Sidebar open={navOpen} />
      {navOpen && (
        <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} aria-hidden="true" />
      )}
      <div className="sidebar-resizer" onMouseDown={startSidebarResize} aria-hidden="true" />
      <main className="main">
        {me && me.canWrite === false && config && (
          <div className="error-banner">
            You are signed in, but your token has no write access to <RepoLink config={config} />
            , so saving pages will fail.{' '}
            {config.provider === 'local'
              ? 'The repository directory is not writable by the server process.'
              : config.provider === 'gitlab'
                ? 'You need at least the Developer role on this project, and a token with api scope.'
                : 'If sign-in uses a GitHub App, install it on this repository (App settings → Install App); with a personal access token, grant it Contents read/write on this repository.'}
          </div>
        )}
        {unconfigured ? <Unconfigured /> : children}
      </main>
    </WikiContext.Provider>
  )
}
