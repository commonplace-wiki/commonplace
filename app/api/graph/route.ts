import { NextResponse } from 'next/server'
import { getRepoConfig } from '@/lib/config'
import { fetchFileTexts, GitHubError, listMarkdownFiles } from '@/lib/repo'
import { conceptTitle, parseConcept } from '@/lib/okf'
import { getSession } from '@/lib/session'

export interface GraphNode {
  id: string
  title: string
  type: string | null
  /** Top-level directory, '' for root pages. */
  dir: string
}

export interface GraphEdge {
  source: string
  target: string
  weight: number
  /** 'link' = markdown link in the content; 'tree' = directory hierarchy. */
  kind: 'link' | 'tree'
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
}

/** Resolve a markdown link target to a bundle path (same rules as the viewer). */
function resolveTarget(href: string, baseDir: string): string | null {
  let target = href.trim()
  if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
  target = target.split('#')[0].split('?')[0]
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return null
  const segments = target.startsWith('/')
    ? target.replace(/^\/+/, '').split('/')
    : [...(baseDir ? baseDir.split('/') : []), ...target.split('/')]
  const out: string[] = []
  for (const part of segments) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

const LINK_RE = /(^|[^!])\[[^\]]*\]\(([^)]+)\)/g

export async function GET() {
  const session = await getSession()
  const config = getRepoConfig()
  if (!config) {
    return NextResponse.json({ error: 'No wiki repository configured (set GIT_REPO)' }, { status: 500 })
  }
  const token = session?.token ?? null
  try {
    const { files, truncated } = await listMarkdownFiles(token, config)
    const texts = await fetchFileTexts(
      token,
      config,
      files.map((f) => f.path)
    )

    const nodes: GraphNode[] = []
    const bodies: Record<string, string> = {}
    for (const file of files) {
      const base = file.path.split('/').pop() || ''
      if (base === 'log.md' || base === 'README.md') continue
      const { frontmatter, body } = parseConcept(texts[file.path] ?? '')
      const tags = Array.isArray(frontmatter?.tags) ? frontmatter.tags : []
      if (tags.some((t) => t === 'hidden')) continue
      // index.md pages represent their directory: show the directory name.
      const title =
        base === 'index.md'
          ? dirOf(file.path)
            ? (dirOf(file.path).split('/').pop() || '').replace(/[-_]/g, ' ')
            : 'Home'
          : conceptTitle(file.path, frontmatter).replace(/\.md$/, '').replace(/[-_]/g, ' ')
      nodes.push({
        id: file.path,
        title,
        type: typeof frontmatter?.type === 'string' ? frontmatter.type : null,
        dir: file.path.includes('/') ? file.path.split('/')[0] : '',
      })
      bodies[file.path] = body
    }

    const nodeIds = new Set(nodes.map((n) => n.id))
    // Paths may contain any character, so weights are keyed per source node.
    const edges: GraphEdge[] = []
    for (const node of nodes) {
      const baseDir = dirOf(node.id)
      const outgoing = new Map<string, number>()
      for (const match of bodies[node.id].matchAll(LINK_RE)) {
        const target = resolveTarget(match[2], baseDir)
        if (!target || !target.endsWith('.md')) continue
        if (target === node.id || !nodeIds.has(target)) continue
        outgoing.set(target, (outgoing.get(target) || 0) + 1)
      }
      for (const [target, weight] of outgoing) {
        edges.push({ source: node.id, target, weight, kind: 'link' })
      }
    }

    // Directory hierarchy as soft structural edges: every page connects to
    // the nearest ancestor index.md, so the wiki's shape is visible even
    // when pages barely link to each other yet.
    const linked = new Set(edges.flatMap((e) => [`${e.source}\n${e.target}`, `${e.target}\n${e.source}`]))
    for (const node of nodes) {
      if (!node.id.includes('/') && node.id === 'index.md') continue
      let dir = node.id.endsWith('/index.md') ? dirOf(dirOf(node.id)) : dirOf(node.id)
      for (;;) {
        const parentIndex = dir ? `${dir}/index.md` : 'index.md'
        if (parentIndex !== node.id && nodeIds.has(parentIndex)) {
          if (!linked.has(`${parentIndex}\n${node.id}`)) {
            edges.push({ source: parentIndex, target: node.id, weight: 1, kind: 'tree' })
          }
          break
        }
        if (!dir) break
        dir = dirOf(dir)
      }
    }

    return NextResponse.json({ nodes, edges, truncated })
  } catch (err) {
    if (!session && err instanceof GitHubError && [401, 403, 404].includes(err.status)) {
      return NextResponse.json({ error: 'Sign-in required' }, { status: 401 })
    }
    const status = err instanceof GitHubError ? err.status : 502
    return NextResponse.json({ error: err instanceof Error ? err.message : 'GitHub request failed' }, { status })
  }
}
