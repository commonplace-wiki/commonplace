import { NextRequest, NextResponse } from 'next/server'
import { getRepoConfig, fullPath, type RepoConfig } from '@/lib/config'
import {
  fetchFileTexts,
  getFile,
  GitHubError,
  listMarkdownFiles,
  putFile,
} from '@/lib/github'
import { updateLog } from '@/lib/log'
import { conceptTitle, isReservedName, parseConcept, serializeConcept } from '@/lib/okf'

/**
 * MCP server (Streamable HTTP transport, stateless) exposing the wiki to AI
 * agents. Authenticate with a GitHub token: `Authorization: Bearer <token>`.
 * Reads work without a token when the wiki repository is public; saving
 * always requires one. All writes go through the same OKF rules as the
 * editor: required type, automatic timestamp, log.md entry, and blob-SHA
 * conflict detection.
 */

const PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'commonplace', version: '0.1.0' }

const TOOLS = [
  {
    name: 'search_pages',
    description:
      'Search wiki pages by content, title, path, tag, or OKF concept type. ' +
      'Returns matching pages with path, title, type, tags, description, and a snippet. ' +
      'Omit all filters to list every page.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text matched against title, path, and page content' },
        tag: { type: 'string', description: 'Only pages carrying this frontmatter tag' },
        type: { type: 'string', description: 'Only pages of this OKF concept type' },
        limit: { type: 'number', description: 'Maximum results (default 10)' },
      },
    },
  },
  {
    name: 'get_page',
    description:
      'Fetch one wiki page: OKF frontmatter, markdown body, blob sha (needed to update it), and GitHub URL. ' +
      'Paths are bundle-relative, e.g. "how_to/onboarding.md".',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Bundle-relative path ending in .md' } },
      required: ['path'],
    },
  },
  {
    name: 'save_page',
    description:
      'Create or update a wiki page as a git commit. Frontmatter fields merge over the existing ones; ' +
      'the OKF timestamp is set automatically and the change is recorded in log.md. ' +
      'When updating, pass the sha from get_page so concurrent edits are detected instead of overwritten.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Bundle-relative path ending in .md' },
        body: { type: 'string', description: 'Markdown body (without frontmatter)' },
        title: { type: 'string' },
        type: { type: 'string', description: 'OKF concept type (defaults to the wiki default for new pages)' },
        description: { type: 'string' },
        resource: { type: 'string', description: 'Canonical URI of the underlying asset' },
        tags: { type: 'array', items: { type: 'string' } },
        message: { type: 'string', description: 'Commit message' },
        sha: { type: 'string', description: 'Blob sha of the version being updated (from get_page)' },
        updateLog: { type: 'boolean', description: 'Record the change in log.md (default true)' },
      },
      required: ['path', 'body'],
    },
  },
]

interface Ctx {
  token: string | null
  config: RepoConfig
}

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization') || ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

function snippet(text: string, query: string): string | null {
  const lower = text.toLowerCase()
  const at = lower.indexOf(query.toLowerCase())
  if (at === -1) return null
  const start = Math.max(0, text.lastIndexOf('\n', at) + 1)
  let end = text.indexOf('\n', at + query.length)
  if (end === -1) end = text.length
  return text.slice(start, Math.min(end, start + 300)).trim()
}

async function searchPages(ctx: Ctx, args: Record<string, unknown>) {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  const tag = typeof args.tag === 'string' ? args.tag.trim() : ''
  const type = typeof args.type === 'string' ? args.type.trim() : ''
  const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 50) : 10

  const { files, truncated } = await listMarkdownFiles(ctx.token, ctx.config)
  const texts = await fetchFileTexts(
    ctx.token,
    ctx.config,
    files.map((f) => f.path)
  )

  const results: {
    path: string
    title: string
    type: string | null
    tags: string[]
    description: string | null
    snippet?: string
    score: number
  }[] = []

  for (const file of files) {
    const text = texts[file.path] ?? ''
    const { frontmatter, body } = parseConcept(text)
    const fmTitle = typeof frontmatter?.title === 'string' ? frontmatter.title : ''
    const title = fmTitle || conceptTitle(file.path, frontmatter)
    const pageTags = Array.isArray(frontmatter?.tags)
      ? frontmatter.tags.filter((t): t is string => typeof t === 'string')
      : []
    const pageType = typeof frontmatter?.type === 'string' ? frontmatter.type : null

    if (tag && !pageTags.some((t) => t.toLowerCase() === tag.toLowerCase())) continue
    if (type && (pageType || '').toLowerCase() !== type.toLowerCase()) continue

    let score = 1
    let matchSnippet: string | undefined
    if (query) {
      const q = query.toLowerCase()
      score = 0
      if (title.toLowerCase().includes(q)) score += 3
      if (file.path.toLowerCase().includes(q)) score += 2
      const bodyHit = snippet(body, query)
      if (bodyHit) {
        score += 1
        matchSnippet = bodyHit
      }
      if (score === 0) continue
    }

    results.push({
      path: file.path,
      title,
      type: pageType,
      tags: pageTags,
      description: typeof frontmatter?.description === 'string' ? frontmatter.description : null,
      ...(matchSnippet ? { snippet: matchSnippet } : {}),
      score,
    })
  }

  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  return {
    total: results.length,
    ...(truncated ? { note: 'Repository tree was truncated; results may be incomplete.' } : {}),
    pages: results.slice(0, limit).map(({ score: _score, ...rest }) => rest),
  }
}

async function getPage(ctx: Ctx, args: Record<string, unknown>) {
  const path = typeof args.path === 'string' ? args.path.replace(/^\/+/, '') : ''
  if (!path.endsWith('.md')) throw new Error('path must point to a .md file')
  const repoPath = fullPath(ctx.config, path)
  const file = await getFile(ctx.token, ctx.config, repoPath)
  const { frontmatter, body } = parseConcept(file.content)
  return {
    path,
    sha: file.sha,
    frontmatter,
    body,
    htmlUrl: `https://github.com/${ctx.config.owner}/${ctx.config.repo}/blob/${ctx.config.branch}/${repoPath}`,
  }
}

async function savePage(ctx: Ctx, args: Record<string, unknown>) {
  if (!ctx.token) throw new Error('Saving requires a GitHub token (Authorization: Bearer <token>).')
  const path = typeof args.path === 'string' ? args.path.replace(/^\/+/, '') : ''
  if (!path.endsWith('.md')) throw new Error('path must point to a .md file')
  const repoPath = fullPath(ctx.config, path)
  const body = typeof args.body === 'string' ? args.body : ''
  const reserved = isReservedName(path)

  // Load the current version for its sha and, on updates, to merge
  // frontmatter so producer extension keys survive agent edits.
  let existing: { sha: string; frontmatter: Record<string, unknown> | null } | null = null
  try {
    const file = await getFile(ctx.token, ctx.config, repoPath)
    existing = { sha: file.sha, frontmatter: parseConcept(file.content).frontmatter }
  } catch (err) {
    if (!(err instanceof GitHubError && err.status === 404)) throw err
  }
  const sha = typeof args.sha === 'string' && args.sha ? args.sha : existing?.sha

  let content: string
  let frontmatter: Record<string, unknown> | null = null
  if (reserved) {
    content = body.replace(/\s+$/, '') + '\n'
  } else {
    frontmatter = { ...(existing?.frontmatter || {}) }
    for (const key of ['title', 'type', 'description', 'resource'] as const) {
      if (typeof args[key] === 'string') frontmatter[key] = args[key]
    }
    if (Array.isArray(args.tags)) frontmatter.tags = args.tags.filter((t) => typeof t === 'string')
    if (typeof frontmatter.type !== 'string' || !(frontmatter.type as string).trim()) {
      throw new Error('Frontmatter "type" is required by OKF for concept documents — pass a type.')
    }
    frontmatter.timestamp = new Date().toISOString()
    content = serializeConcept(frontmatter, body)
  }

  const message =
    typeof args.message === 'string' && args.message.trim()
      ? args.message.trim()
      : `${existing ? 'Update' : 'Create'} ${path} via MCP`

  const newSha = await putFile(ctx.token, ctx.config, repoPath, content, message, sha)
  if (!reserved && args.updateLog !== false) {
    await updateLog(ctx.token, ctx.config, existing ? 'Update' : 'Creation', path, conceptTitle(path, frontmatter))
  }
  return {
    path,
    sha: newSha,
    action: existing ? 'updated' : 'created',
    htmlUrl: `https://github.com/${ctx.config.owner}/${ctx.config.repo}/blob/${ctx.config.branch}/${repoPath}`,
  }
}

async function callTool(ctx: Ctx, name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'search_pages':
      return searchPages(ctx, args)
    case 'get_page':
      return getPage(ctx, args)
    case 'save_page':
      return savePage(ctx, args)
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

interface RpcMessage {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
}

function rpcResult(id: number | string | null, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

async function handleMessage(req: NextRequest, msg: RpcMessage): Promise<object | null> {
  const id = msg.id ?? null
  // Notifications (no id) get no response.
  if (msg.id === undefined) return null

  switch (msg.method) {
    case 'initialize': {
      const requested = msg.params?.protocolVersion
      return rpcResult(id, {
        protocolVersion: typeof requested === 'string' ? requested : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'Commonplace wiki: every page is a markdown file with OKF frontmatter in a GitHub repository. ' +
          'Use search_pages to find content, get_page to read (returns the sha), and save_page to write. ' +
          'Link pages with bundle-absolute markdown links like [title](/path/page.md).',
      })
    }
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS })
    case 'tools/call': {
      const config = getRepoConfig()
      if (!config) {
        return rpcError(id, -32603, 'This deployment has no wiki repository configured (set GIT_REPO).')
      }
      const ctx: Ctx = { token: bearerToken(req), config }
      const name = typeof msg.params?.name === 'string' ? msg.params.name : ''
      const args = (msg.params?.arguments as Record<string, unknown>) || {}
      try {
        const result = await callTool(ctx, name, args)
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
      } catch (err) {
        const detail =
          err instanceof GitHubError && [401, 403, 404].includes(err.status) && !ctx.token
            ? `${err.message} — the repository is not publicly readable; pass a GitHub token as "Authorization: Bearer <token>".`
            : err instanceof Error
              ? err.message
              : 'Tool call failed'
        return rpcResult(id, { content: [{ type: 'text', text: detail }], isError: true })
      }
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`)
  }
}

export async function POST(req: NextRequest) {
  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 })
  }
  const messages = Array.isArray(payload) ? payload : [payload]
  const responses = (
    await Promise.all(messages.map((m) => handleMessage(req, m as RpcMessage)))
  ).filter((r): r is object => r !== null)

  // Only notifications: acknowledge without a body.
  if (responses.length === 0) return new NextResponse(null, { status: 202 })
  const body = Array.isArray(payload) ? responses : responses[0]
  return NextResponse.json(body)
}

// This server is stateless and never opens a server-initiated stream.
export async function GET() {
  return new NextResponse('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } })
}
