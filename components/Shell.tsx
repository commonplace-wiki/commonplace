'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import Sidebar from './Sidebar'

export interface Me {
  login: string
  avatarUrl: string
}

export interface RepoConfig {
  owner: string
  repo: string
  branch: string
  root: string
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
  /** True when the repository is pinned by the deployment (WIKI_REPO). */
  fixedConfig: boolean
  /** Every .md file of the bundle with its frontmatter title. Null while loading. */
  files: WikiFile[] | null
  treeError: string | null
  settings: WikiSettings | null
  refreshTree: () => void
  refreshSettings: () => void
}

const WikiContext = createContext<WikiContextValue>({
  me: null,
  config: null,
  fixedConfig: false,
  files: null,
  treeError: null,
  settings: null,
  refreshTree: () => {},
  refreshSettings: () => {},
})

export function useWiki() {
  return useContext(WikiContext)
}

function UserMenu({ me, fixedConfig, onLogout }: { me: Me; fixedConfig: boolean; onLogout: () => void }) {
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
            Wiki settings
          </Link>
          {!fixedConfig && (
            <Link href="/login" className="user-menu-item" onClick={() => setOpen(false)}>
              Change repository
            </Link>
          )}
          <a
            href={`https://github.com/${me.login}`}
            target="_blank"
            rel="noreferrer"
            className="user-menu-item"
          >
            GitHub profile
          </a>
          <div className="user-menu-sep" />
          <button className="user-menu-item" onClick={onLogout}>
            Sign out
          </button>
        </div>
      )}
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
    if (!p || p === 'settings' || p === 'login' || p.startsWith('edit/') || p.startsWith('wiki/')) return ''
    if (p.endsWith('.md')) return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
    return p
  })()
  const [me, setMe] = useState<Me | null>(null)
  /** True once /api/me answered: me === null then means anonymous viewer. */
  const [authResolved, setAuthResolved] = useState(false)
  const [config, setConfig] = useState<RepoConfig | null>(null)
  const [fixedConfig, setFixedConfig] = useState(false)
  const [files, setFiles] = useState<WikiFile[] | null>(null)
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
    fetch('/api/tree')
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
        setTreeError(null)
        try {
          sessionStorage.setItem('okf_tree', JSON.stringify({ files: data.files, logo: data.logo || null }))
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
    fetchTree()
    setTimeout(fetchTree, 1500)
    setTimeout(fetchTree, 4000)
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
        router.replace('/login')
        return
      }
      if (meRes.status === 401) {
        // Anonymous viewer: reads work on public repos, editing needs sign-in.
        // If the repo turns out to be private, the tree request 401s and
        // redirects to /login from there.
        setConfig(cfgData.config)
        setFixedConfig(Boolean(cfgData.fixed))
        setAuthResolved(true)
        return
      }
      const meData = await meRes.json()
      setMe(meData)
      setConfig(cfgData.config)
      setFixedConfig(Boolean(cfgData.fixed))
      setAuthResolved(true)
    }
    boot()
    return () => {
      cancelled = true
    }
  }, [router, fetchTree, refreshSettings])

  useEffect(() => {
    if (settings !== null) document.title = settings.name || 'Commonplace'
  }, [settings])

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
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/login')
  }

  return (
    <WikiContext.Provider
      value={{ me, config, fixedConfig, files, treeError, settings, refreshTree, refreshSettings }}
    >
      <header className="topbar">
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
        {me && <UserMenu me={me} fixedConfig={fixedConfig} onLogout={logout} />}
      </header>
      <Sidebar />
      <div className="sidebar-resizer" onMouseDown={startSidebarResize} aria-hidden="true" />
      <main className="main">{children}</main>
    </WikiContext.Provider>
  )
}
