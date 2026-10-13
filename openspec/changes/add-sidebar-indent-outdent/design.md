# Design

## Context

See `proposal.md` — Why. Relevant current state:

- `components/Sidebar.tsx` builds the navigation tree (`Node` with `path`, `isDir`, optional `pagePath`) and renders one `TreeLevel` per sibling group. Drag & drop reorders siblings by calling `PUT /api/order`, which rewrites one directory's entry in `.commonplace/order.yaml`. It already tracks a `saving` state per row.
- `app/api/move/route.ts` (`POST /api/move`) moves a page: it accepts `{ path, toDir, newName, title, updateLog }`, requires `path` to end in `.md`, and builds two moves — the page and its same-named subpage directory. It rewrites bundle-absolute links, calls `syncOrderAfterMove` to keep `order.yaml` in step, and appends a `Move` entry to `log.md`.
- `lib/github.ts` `movePaths` iterates every blob in the repository and matches `item.path === m.from || item.path.startsWith(`${m.from}/`)`. A `from` that is a directory therefore moves the whole subtree in one commit.
- The order sync currently **drops** a moved page's entry when it changes directory, so the page falls back to title sort. That is fine for the editor's move form but not enough to guarantee "last child" / "immediately after former parent".

## Goals / Non-Goals

**Goals:**
- One reusable path that both the sidebar buttons and the existing editor move form share.
- Deterministic destination position, not a title-sort fallback.
- Move folders that have no page of their own.
- Reuse the existing move pipeline (link rewrite, order sync, log) so behavior stays consistent.

**Non-Goals:**
- Changing drag & drop reordering (it stays sibling-only).
- Adding indent/outdent to the editor (its move form already exists).
- Persisting any hierarchy metadata; the filesystem layout plus `order.yaml` remain the source of truth.
- Section-number display (delivered by the separate `add-page-numbering` change).

## Decisions

### Decision: Compute the destination in the sidebar, execute through `/api/move`
For a node at sibling index `i` in group `dir`:
- **Indent** → destination directory is the preceding sibling's subtree path: `prev.isDir ? prev.path : prev.path.replace(/\.md$/, '')`. Disabled when `i === 0`.
- **Outdent** → destination directory is the parent of `dir` (`dir` is `''` at the top level, so outdent is disabled there).

The request keeps the node's basename as `newName` (indent/outdent never rename).

*Alternatives considered:* a dedicated `/api/tree` mutation endpoint — rejected as duplication; the existing route already does the hard parts.

### Decision: Extend `/api/move` to move a node without a page
When `path` does not end in `.md`, the route treats it as a folder-only node and issues a single move `{ from: <dir>, to: <toDir>/<basename> }`; `movePaths` already expands a directory `from` into all of its blobs, so descendants move together. The route's subtree computation and `syncOrderAfterMove` must strip `.md` only for page paths and use the directory itself otherwise. The "cannot move below its own subpages" guard uses the node's subtree path, which is `path` for a folder and `path` without `.md` for a page.

*Alternatives considered:* requiring every folder to have a page — rejected, because folders created by the editor's move form are plain directories and must be movable.

### Decision: Send the destination order with the move
Extend the `/api/move` payload with an optional `order: { dir: string, children: string[] }`. `syncOrderAfterMove` applies it after moving entries, so `map[dir]` becomes the exact desired child list. The sidebar builds that list from the tree it already renders:
- **Indent**: the preceding sibling's current children in order, with the moved name appended (last child).
- **Outdent**: the parent group's current children in order, with the moved name inserted immediately after the former parent.

*Rationale:* positioning is deterministic and rides the move's existing order-sync step instead of a second, racing `PUT /api/order`.

*Alternatives considered:* a follow-up `PUT /api/order` from the client — rejected (extra round trip, race with the route's own order sync); changing title sort — rejected (indirect and non-deterministic).

### Decision: Optimistic UI with rollback, reusing the existing row state
The sidebar marks the moved row as saving (disabling its controls), applies the expected order override immediately, and calls the endpoint. On success it calls `refreshTree()`; on failure it restores the previous order override and shows an error line, mirroring the drag & drop path. Indent/outdent are disabled when `me.canWrite === false` or a move is in flight.

### Decision: Controls live on the sidebar row
A small button pair (outdent then indent, matching left-to-right reading) sits at the end of `tree-row`, styled like `.tree-toggle`, hidden by default and revealed on `:hover`/`:focus-within`, and always visible on `.tree-row.active`. Both placements asked for are therefore covered: reveal-on-hover for any row, and persistent for the active page.

## Risks / Trade-offs

- [Whole-subtree moves read the entire repository tree and blob texts] → Same cost as the existing editor move; acceptable, and GitHub already rejects oversized trees with a clear error.
- [Destination name collision] → `movePaths` returns 409 for an existing target; surfaced as an error and the optimistic order is reverted.
- [Positioning must materialize `order.yaml` for groups that had no entry] → The sidebar writes the full child list it is already displaying, so the result matches what the user sees.
- [Extending `/api/move` touches shared code used by the editor] → Keep the page path behavior identical and add the folder path as a new branch; cover both with the existing move tests/manual checks.
- [Concurrent commits from two users] → The move reads the branch head and fails loudly on conflict; the UI reverts, same as today.

## Migration Plan

No data migration. Additive UI plus a backward-compatible extension of `/api/move` (new optional `order` field and folder paths). Roll back by reverting the commit; no stored state changes.

## Open Questions

- Exact control glyphs (`>`/`<` vs `→`/`←`) and their placement within the row. Cosmetic; settle during implementation without affecting the specs or tasks.
