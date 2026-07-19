'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import Markdown from '@/components/Markdown'
import { useWiki } from '@/components/Shell'

interface FileData {
  path: string
  sha: string
  frontmatter: Record<string, unknown> | null
  body: string
  isReserved: boolean
  htmlUrl: string
  historyUrl?: string
  lastCommit?: {
    date: string
    name: string
    login: string | null
    avatarUrl: string | null
  } | null
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

/** "just now" / "5 minutes ago" / … within the last 7 days, else the date. */
function formatUpdated(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso.slice(0, 10)
  const minutes = Math.floor((Date.now() - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return iso.slice(0, 10)
}

function FrontmatterCard({ fm }: { fm: Record<string, unknown> }) {
  const { settings } = useWiki()
  const rawType = typeof fm.type === 'string' ? fm.type : null
  // The default type carries no information; only show distinctive types.
  const type = rawType && rawType !== (settings?.default_type || 'Wiki Page') ? rawType : null
  const tags = Array.isArray(fm.tags) ? fm.tags.filter((t) => typeof t === 'string') : []
  const resource = typeof fm.resource === 'string' ? fm.resource : null
  if (!type && tags.length === 0 && !resource) return null
  return (
    <div className="meta-card">
      {type && <span className="type-badge">{type}</span>}
      {tags.length > 0 && (
        <span>
          {tags.map((t) => (
            <span key={t as string} className="tag">
              {t as string}
            </span>
          ))}
        </span>
      )}
      {resource && (
        <span>
          resource:{' '}
          {/^https?:\/\//.test(resource) ? (
            <a href={resource} target="_blank" rel="noreferrer">
              {resource}
            </a>
          ) : (
            <code>{resource}</code>
          )}
        </span>
      )}
    </div>
  )
}

function DirectoryListing({ dir }: { dir: string }) {
  const { files, me } = useWiki()
  const prefix = dir ? `${dir}/` : ''
  const { childDirs, childFiles } = useMemo(() => {
    const dirs = new Set<string>()
    const direct: { name: string; title: string }[] = []
    for (const f of files || []) {
      if (f.hidden) continue
      if (prefix && !f.path.startsWith(prefix)) continue
      const rest = f.path.slice(prefix.length)
      if (rest === 'README.md' || rest === 'index.md' || rest === 'log.md') continue
      const slash = rest.indexOf('/')
      if (slash === -1) direct.push({ name: rest, title: f.title || rest.replace(/\.md$/, '').replace(/[-_]/g, ' ') })
      else dirs.add(rest.slice(0, slash))
    }
    return {
      childDirs: [...dirs].sort(),
      childFiles: direct.sort((a, b) => a.title.localeCompare(b.title)),
    }
  }, [files, prefix])

  if (childDirs.length === 0 && childFiles.length === 0) {
    return (
      <p className="muted">
        This directory has no pages yet.
        {me && (
          <>
            {' '}
            <Link href={`/edit/__new__?dir=${encodeURIComponent(dir)}`}>Create one.</Link>
          </>
        )}
      </p>
    )
  }
  return (
    <ul className="dir-listing">
      {childDirs.map((d) => (
        <li key={d}>
          <span className="dir-icon">📁</span>
          <Link href={`/${prefix}${d}`}>{d.replace(/[-_]/g, ' ')}/</Link>
        </li>
      ))}
      {childFiles.map((f) => (
        <li key={f.name}>
          <span className="dir-icon">📄</span>
          <Link href={`/${prefix}${f.name}`}>{f.title}</Link>
        </li>
      ))}
    </ul>
  )
}

function FileView({ path }: { path: string }) {
  const { me } = useWiki()
  const [data, setData] = useState<FileData | null>(null)
  const [error, setError] = useState<{ status: number; message: string } | null>(null)

  useEffect(() => {
    setData(null)
    setError(null)
    fetch(`/api/file?path=${encodeURIComponent(path)}`).then(async (res) => {
      const json = await res.json()
      if (res.ok) setData(json)
      else setError({ status: res.status, message: json.error || 'Failed to load' })
    })
  }, [path])

  if (error && error.status === 404) {
    return (
      <div>
        <h1 className="page-title">Page not found</h1>
        <p className="muted">
          <code>{path}</code> does not exist on this branch.
        </p>
        {me && (
          <Link className="btn btn-primary" href={`/edit/${path}?new=1`}>
            Create this page
          </Link>
        )}
      </div>
    )
  }
  if (error) return <div className="error-banner">{error.message}</div>
  if (!data) return <p className="muted">Loading page…</p>

  const fm = data.frontmatter
  const title =
    fm && typeof fm.title === 'string' && fm.title
      ? fm.title
      : (path.split('/').pop() || path).replace(/\.md$/, '')
  const description = fm && typeof fm.description === 'string' ? fm.description.trim() : null
  // Migrated pages often carry the body's first paragraph as their description;
  // showing it twice back-to-back reads as a bug, so suppress the duplicate.
  const descriptionIsDuplicate = !!description && data.body.trimStart().startsWith(description)

  return (
    <div>
      <div className="page-actions">
        <h1 className="page-title" style={{ marginRight: 'auto' }}>
          {title}
        </h1>
        {me && (
          <Link className="btn" href={`/edit/${path}`}>
            Edit
          </Link>
        )}
      </div>
      {description && !descriptionIsDuplicate && <p className="description">{description}</p>}
      {fm && !data.isReserved && <FrontmatterCard fm={fm} />}
      <Markdown content={data.body} baseDir={dirOf(path)} />
      <footer className="page-footer">
        {data.lastCommit ? (
          <span className="footer-updated">
            {data.lastCommit.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.lastCommit.avatarUrl} alt="" className="footer-avatar" />
            )}
            <span>
              Updated{' '}
              <time dateTime={data.lastCommit.date} title={data.lastCommit.date}>
                {formatUpdated(data.lastCommit.date)}
              </time>{' '}
              by{' '}
              {data.lastCommit.login ? (
                <a href={`https://github.com/${data.lastCommit.login}`} target="_blank" rel="noreferrer">
                  {data.lastCommit.name}
                </a>
              ) : (
                data.lastCommit.name
              )}
            </span>
          </span>
        ) : (
          fm &&
          typeof fm.timestamp === 'string' && (
            <span className="footer-updated">
              Updated{' '}
              <time dateTime={fm.timestamp} title={fm.timestamp}>
                {formatUpdated(fm.timestamp)}
              </time>
            </span>
          )
        )}
        <span className="footer-spacer" />
        <a href={data.htmlUrl} target="_blank" rel="noreferrer">
          View on GitHub
        </a>
        {data.historyUrl && (
          <a href={data.historyUrl} target="_blank" rel="noreferrer">
            History
          </a>
        )}
      </footer>
    </div>
  )
}

interface LogEntry {
  date: string
  action: string
  title: string
  path: string | null
}

/** Parse the OKF log.md body: "## YYYY-MM-DD" headings with bullet entries. */
function parseLog(body: string, limit: number): LogEntry[] {
  const entries: LogEntry[] = []
  let date = ''
  for (const line of body.split('\n')) {
    if (entries.length >= limit) break
    const heading = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/)
    if (heading) {
      date = heading[1]
      continue
    }
    const bullet = line.match(/^[*-]\s+(.*)$/)
    if (!bullet) continue
    const detail = bullet[1].match(/^\*\*(\w+)\*\*:\s*\w+\s*\[([^\]]*)\]\(([^)]+)\)\.?\s*$/)
    if (detail) entries.push({ date, action: detail[1], title: detail[2], path: detail[3] })
    else entries.push({ date, action: '', title: bullet[1].replace(/\*\*/g, ''), path: null })
  }
  return entries
}

const LOG_VERBS: Record<string, string> = {
  Creation: 'Created',
  Update: 'Modified',
  Deletion: 'Deleted',
  Move: 'Moved',
}

/** "today" / "yesterday" / "3 days ago" for date-only log entries. */
function formatLogDate(date: string): string {
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const days = Math.round((midnight - new Date(`${date}T00:00:00`).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return date
}

/** Friendly onboarding for a wiki whose repository has no pages yet. */
function EmptyWiki() {
  const { me, config } = useWiki()
  return (
    <div className="empty-wiki">
      <p>
        This repository
        {config && (
          <>
            {' '}
            (
            <a
              href={`https://github.com/${config.owner}/${config.repo}`}
              target="_blank"
              rel="noreferrer"
            >
              {config.owner}/{config.repo}
            </a>
            )
          </>
        )}{' '}
        is empty.
      </p>
      {me ? (
        <>
          <Link className="btn btn-primary" href="/edit/__new__">
            Create the first page
          </Link>
          <p className="muted">
            Saving commits the page to the repository — the branch is created with it if needed.
          </p>
        </>
      ) : (
        <p className="muted">Sign in to create the first page.</p>
      )}
    </div>
  )
}

/** Last few log.md entries, shown at the bottom of the wiki root page. */
function RecentChanges() {
  const { files } = useWiki()
  const hasLog = (files || []).some((f) => f.path === 'log.md')
  const [entries, setEntries] = useState<LogEntry[] | null>(null)

  useEffect(() => {
    if (!hasLog) return
    fetch('/api/file?path=log.md').then(async (res) => {
      if (res.ok) setEntries(parseLog((await res.json()).body, 7))
    })
  }, [hasLog])

  if (!hasLog || !entries || entries.length === 0) return null
  return (
    <section className="recent-changes">
      <h2>Recent changes</h2>
      <ul>
        {entries.map((e, i) => (
          <li key={i}>
            {e.action && <span className="muted">{LOG_VERBS[e.action] || e.action} </span>}
            {e.path && e.action !== 'Deletion' ? (
              <Link href={`/${e.path.replace(/^\/+/, '')}`}>{e.title}</Link>
            ) : (
              e.title
            )}
            {e.date && <span className="muted"> · {formatLogDate(e.date)}</span>}
          </li>
        ))}
      </ul>
      <Link href="/log.md" className="muted">
        View full log
      </Link>
    </section>
  )
}

function DirectoryView({ dir }: { dir: string }) {
  const { files, settings, me } = useWiki()
  const indexPath = dir ? `${dir}/index.md` : 'index.md'
  const hasIndex = (files || []).some((f) => f.path === indexPath)
  const [index, setIndex] = useState<FileData | null>(null)

  useEffect(() => {
    setIndex(null)
    if (!hasIndex) return
    fetch(`/api/file?path=${encodeURIComponent(indexPath)}`).then(async (res) => {
      if (res.ok) setIndex(await res.json())
    })
  }, [indexPath, hasIndex])

  const name = dir ? dir.split('/').pop() : settings?.name || 'Home'

  return (
    <div>
      <div className="page-actions">
        <h1 className="page-title" style={{ marginRight: 'auto' }}>
          {name}
        </h1>
        {me && hasIndex && (
          <Link className="btn" href={`/edit/${indexPath}`}>
            Edit
          </Link>
        )}
        {me && !hasIndex && (
          <Link className="btn" href={`/edit/${indexPath}?new=1`}>
            Add index.md
          </Link>
        )}
      </div>
      {files === null && <p className="muted">Loading…</p>}
      {files !== null && hasIndex && index && <Markdown content={index.body} baseDir={dir} />}
      {files !== null && hasIndex && !index && <p className="muted">Loading index…</p>}
      {files !== null &&
        !hasIndex &&
        (!dir && files.length === 0 ? <EmptyWiki /> : <DirectoryListing dir={dir} />)}
      {!dir && <RecentChanges />}
    </div>
  )
}

export default function WikiPage() {
  const params = useParams<{ path?: string[] }>()
  const segments = (params.path || []).map((s) => decodeURIComponent(s))
  const path = segments.join('/')
  const isFile = path.endsWith('.md')

  return isFile ? <FileView key={path} path={path} /> : <DirectoryView key={path} dir={path} />
}
