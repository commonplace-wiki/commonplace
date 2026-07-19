import yaml from 'js-yaml'

/**
 * Sidebar sort order, stored centrally in .commonplace/order.yaml so a
 * reorder is one commit that touches no page content. Maps a directory's
 * bundle path ('' for the root) to its child names in display order.
 * Names carry no .md suffix: a page and its same-named subpage directory
 * are one sidebar node. Unlisted children sort by title after listed ones.
 */
export const ORDER_FILE = '.commonplace/order.yaml'

export type OrderMap = Record<string, string[]>

/** Name of a tree node in an order list: basename without the .md suffix. */
export function orderName(path: string): string {
  const base = path.split('/').pop() || path
  return base.replace(/\.md$/, '')
}

export function parseOrderMap(content: string): OrderMap {
  let raw: unknown
  try {
    raw = yaml.load(content)
  } catch {
    return {}
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const map: OrderMap = {}
  for (const [dir, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue
    const names = value
      .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
      .map((v) => orderName(String(v).trim()))
      .filter(Boolean)
    if (names.length) map[dir.replace(/^\/+|\/+$/g, '')] = names
  }
  return map
}

export function serializeOrderMap(map: OrderMap): string {
  return (
    '# Commonplace sidebar order — edited via drag & drop in the wiki UI, safe to edit by hand.\n' +
    '# Maps a directory path ("" for the root) to its pages/subdirectories in display order.\n' +
    yaml.dump(map, { lineWidth: 120, noRefs: true })
  )
}
