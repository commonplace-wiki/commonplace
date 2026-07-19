import matter from 'gray-matter'
import yaml from 'js-yaml'

/**
 * Helpers for Google's Open Knowledge Format (OKF) v0.1.
 * https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
 */

/** Frontmatter keys defined by the spec, in canonical serialization order. */
export const OKF_KEYS = ['type', 'title', 'description', 'resource', 'tags', 'timestamp'] as const

export type Frontmatter = Record<string, unknown>

/** index.md and log.md are reserved filenames and never carry concept frontmatter. */
export function isReservedName(bundlePath: string): boolean {
  const base = bundlePath.split('/').pop() || ''
  return base === 'index.md' || base === 'log.md'
}

export interface ParsedConcept {
  frontmatter: Frontmatter | null
  body: string
}

export function parseConcept(raw: string): ParsedConcept {
  const hasFrontmatter = /^---\r?\n/.test(raw)
  if (!hasFrontmatter) return { frontmatter: null, body: raw }
  try {
    const parsed = matter(raw)
    return { frontmatter: parsed.data as Frontmatter, body: parsed.content.replace(/^\r?\n/, '') }
  } catch {
    return { frontmatter: null, body: raw }
  }
}

/**
 * Serialize a concept document: OKF keys first in canonical order, then any
 * producer extension keys (which must be preserved round-trip).
 */
export function serializeConcept(frontmatter: Frontmatter, body: string): string {
  const ordered: Frontmatter = {}
  for (const key of OKF_KEYS) {
    const value = frontmatter[key]
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    ordered[key] = value
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    if ((OKF_KEYS as readonly string[]).includes(key)) continue
    ordered[key] = value
  }
  const fm = yaml.dump(ordered, { lineWidth: 120, noRefs: true })
  const trimmedBody = body.replace(/\s+$/, '')
  return `---\n${fm}---\n\n${trimmedBody}\n`
}

export type LogAction = 'Creation' | 'Update' | 'Deletion' | 'Move'

const LOG_VERBS: Record<LogAction, string> = {
  Creation: 'Created',
  Update: 'Modified',
  Deletion: 'Deleted',
  Move: 'Moved',
}

/**
 * Prepend an entry to a log.md body (newest-first, grouped by ISO date),
 * per OKF spec section 7.
 */
export function appendLogEntry(
  existing: string | null,
  action: LogAction,
  bundlePath: string,
  title: string,
  date: string
): string {
  const line = `* **${action}**: ${LOG_VERBS[action]} [${title}](/${bundlePath}).`
  const dateHeading = `## ${date}`
  if (!existing || !existing.trim()) {
    return `# Update Log\n\n${dateHeading}\n${line}\n`
  }
  if (existing.includes(dateHeading)) {
    return existing.replace(dateHeading, `${dateHeading}\n${line}`)
  }
  const match = existing.match(/^## /m)
  if (match && match.index !== undefined) {
    return existing.slice(0, match.index) + `${dateHeading}\n${line}\n\n` + existing.slice(match.index)
  }
  return `${existing.replace(/\s+$/, '')}\n\n${dateHeading}\n${line}\n`
}

/** Derive a display title for a concept from frontmatter or its filename. */
export function conceptTitle(bundlePath: string, frontmatter: Frontmatter | null): string {
  const fmTitle = frontmatter?.title
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle
  const base = bundlePath.split('/').pop() || bundlePath
  return base.replace(/\.md$/, '')
}
