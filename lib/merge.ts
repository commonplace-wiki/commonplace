import { diff3Merge } from 'node-diff3'

/**
 * Three-way merge of markdown bodies, line-based. Returns the merged text,
 * or null when our and their changes overlap and a human has to decide.
 */
export function mergeBodies(base: string, ours: string, theirs: string): string | null {
  if (ours === theirs) return ours
  if (base === ours) return theirs
  if (base === theirs) return ours
  const regions = diff3Merge(ours.split('\n'), base.split('\n'), theirs.split('\n'))
  const lines: string[] = []
  for (const region of regions) {
    if (!region.ok) return null
    lines.push(...region.ok)
  }
  return lines.join('\n')
}

/**
 * Three-way merge of frontmatter, per key: a side that left a key untouched
 * yields to the side that changed it. Returns null when both sides changed
 * the same key to different values. `timestamp` is server-assigned on every
 * save and never a conflict.
 */
export function mergeFrontmatter(
  base: Record<string, unknown>,
  ours: Record<string, unknown>,
  theirs: Record<string, unknown>
): Record<string, unknown> | null {
  const keys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])
  keys.delete('timestamp')
  const merged: Record<string, unknown> = {}
  for (const key of keys) {
    const b = key in base ? JSON.stringify(base[key]) : undefined
    const o = key in ours ? JSON.stringify(ours[key]) : undefined
    const t = key in theirs ? JSON.stringify(theirs[key]) : undefined
    let winner: Record<string, unknown>
    if (o === t || t === b) winner = ours
    else if (o === b) winner = theirs
    else return null
    if (key in winner) merged[key] = winner[key]
  }
  return merged
}
