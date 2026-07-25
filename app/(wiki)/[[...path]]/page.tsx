import type { Metadata } from 'next'
import yaml from 'js-yaml'
import { fullPath, getRepoConfig, type RepoConfig } from '@/lib/config'
import { parseConcept } from '@/lib/okf'
import { getFile } from '@/lib/repo'
import { getSession } from '@/lib/session'
import WikiPage from './WikiPage'

/**
 * Server wrapper whose only job is the document <title>: "Page - Wiki Name -
 * Commonplace", most specific first, following the Confluence convention
 * ("Page - Space - Confluence"). Rendering stays in the WikiPage client
 * component; the reads here are usually served by the mirror clone, so the
 * title costs disk reads, not API calls.
 */

/** Give a slow provider API at most this long before the title falls back. */
const METADATA_TIMEOUT_MS = 2000

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), METADATA_TIMEOUT_MS).unref?.()),
  ])
}

async function readSettings(
  token: string | null,
  config: RepoConfig
): Promise<{ name: string; description: string }> {
  const file = await getFile(token, config, fullPath(config, '.commonplace/settings.yaml'))
  const parsed = yaml.load(file.content) as { name?: unknown; description?: unknown } | null
  return {
    name: typeof parsed?.name === 'string' ? parsed.name.trim() : '',
    description: typeof parsed?.description === 'string' ? parsed.description.trim() : '',
  }
}

async function readPage(
  token: string | null,
  config: RepoConfig,
  path: string
): Promise<{ title: string | null; description: string | null }> {
  const file = await getFile(token, config, fullPath(config, path))
  const fm = parseConcept(file.content).frontmatter
  return {
    title: fm && typeof fm.title === 'string' && fm.title ? fm.title : null,
    description: fm && typeof fm.description === 'string' ? fm.description.trim() || null : null,
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ path?: string[] }>
}): Promise<Metadata> {
  const segments = ((await params).path || []).map((s) => decodeURIComponent(s))
  const path = segments.join('/')
  const isFile = path.endsWith('.md')
  // Fallbacks that need no repository read, matching the client's headings.
  let pageTitle = path ? (segments[segments.length - 1] || path).replace(/\.md$/, '') : ''
  let name = ''
  let description: string | null = null

  const config = getRepoConfig()
  if (config) {
    const token = (await getSession())?.token ?? null
    const none = { title: null, description: null }
    const [settings, page] = await Promise.all([
      withTimeout(readSettings(token, config), { name: '', description: '' }),
      isFile ? withTimeout(readPage(token, config, path), none) : Promise.resolve(none),
    ])
    name = settings.name
    if (page.title) pageTitle = page.title
    description = page.description || (path ? null : settings.description || null)
  }

  // A wiki named "Commonplace" (or a page titled like the wiki) would repeat
  // itself in the title; drop the duplicate part.
  const parts = [path ? pageTitle : null, name, 'Commonplace'].filter(Boolean) as string[]
  const title = parts.filter((p, i) => p !== parts[i - 1]).join(' - ')
  return description ? { title, description } : { title }
}

export default function Page() {
  return <WikiPage />
}
