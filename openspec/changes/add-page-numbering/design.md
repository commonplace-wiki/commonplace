# Design

## Context

See `proposal.md` — Why. The relevant current state:

- `components/Sidebar.tsx` builds the navigation tree from `files` (from `/api/tree`) and `order` (`.commonplace/order.yaml`) in `buildTree()`, then renders `Node`s. It already applies drag & drop reordering, persisting one directory's child order via `PUT /api/order` and optimistically overriding `order` locally.
- `components/Shell.tsx` owns `files` and `order` in state and exposes them through the `useWiki()` context. `refreshTree()` reloads the tree after a write.
- `app/(wiki)/[[...path]]/WikiPage.tsx` renders either `FileView` (a page, title from frontmatter) or `DirectoryView` (a folder, or a folder's Confluence-style twin page).
- The ordering rule is already centralized: listed children in `order.yaml` first, then the rest by title (`Sidebar.tsx` `merge`).

The tree and its ordering therefore already exist in exactly one place; numbering only needs to be derived from that ordered tree and shared with the page view.

## Goals / Non-Goals

**Goals:**
- One pure, shared function that turns `files` + `order` into a numbered navigation tree.
- A path → number lookup so the page view can show the same number the sidebar shows.
- Numbers that always follow the effective sidebar order, including after a reorder.

**Non-Goals:**
- Persisting numbers anywhere (frontmatter, `order.yaml`, URLs).
- Numbering in-page headings, tables of contents, search results, the home link, or the graph link.
- Changing the OKF frontmatter or any API payload shape.

## Decisions

### Decision: Derive numbers from the ordered tree, not from stored data
Compute a node's number as the 1-based positions from the root joined by `.` (e.g. `1.1.2`). This keeps `order.yaml` the single source of truth and satisfies "no number is persisted".

*Alternatives considered:* storing a `number`/`order` field per page in frontmatter — rejected because it duplicates ordering, drifts from the sidebar, and touches repository content. Manual numbers — rejected by the user's choice of automatic numbering.

### Decision: Extract tree building and numbering into a shared pure module
Move `buildTree` (and its `Node` type, `orderKey`, `pretty`) out of `Sidebar.tsx` into a shared module (e.g. `lib/nav.ts`) and add a `number` field to `Node`. Add a helper that returns a `Map<string, string>` from a node's `path` — and, for a merged folder/page, also its `pagePath` — to its number.

*Rationale:* both the sidebar and the page view need identical numbers; one pure function avoids two implementations drifting. It is also trivially unit-testable.

*Alternatives considered:* recomputing numbering independently inside `WikiPage.tsx` — rejected (duplicated logic, easy to diverge). Deriving numbers from filesystem path segments — rejected (ignores `order.yaml` and title sorting).

### Decision: Share the path → number map through the existing wiki context
`Shell` already holds `files` and `order`; it computes the lookup once (memoized) and exposes it via `WikiContext`. `WikiPage` reads the number for the current path; `Sidebar` builds its own tree from the effective order (so optimistic reorders renumber immediately) and renders `node.number`.

*Rationale:* reuses the existing context and state, no new data fetching. The sidebar's optimistic override stays local to the sidebar, which is where reordering happens.

### Decision: Numbering scope matches the navigation tree exactly
`buildTree` already skips hidden pages and reserved files (`index.md`, `log.md`, `README.md`) and excludes the home/graph/search entries, which are rendered outside `TreeLevel`. Numbering inherits those exclusions, so no extra filtering is needed. A merged folder/page node is numbered once and both its `path` and `pagePath` resolve to that number.

### Decision: Presentation
The sidebar renders the number in its own muted element before the label; the page and directory titles render the number before the title text. The exact separator/style is cosmetic and can be adjusted without touching the derivation.

## Risks / Trade-offs

- [Page title can briefly lag an optimistic sidebar reorder] → `refreshTree()` already reloads the committed order after a reorder; the title converges on the next render. Reordering does not normally happen while reading the affected page.
- [Long numbers on deep trees] → Numbers are display-only and width-clamped by the sidebar layout; no functional impact.
- [Directory listing order differs from nav order] → The number comes from the navigation tree, not the listing; the listing remains a plain index. Documented as out of scope.
- [Merged folder/page numbering] → Resolved by mapping both the directory path and its page path to the same node number; covered by a scenario in the spec.

## Migration Plan

No data migration. The change is additive UI plus a refactor of tree building. Deploy by merging; roll back by reverting the commit — no stored state changes.

## Open Questions

- Exact number styling/separator (e.g. `1.1` vs `1.1.` vs `1.1 ·`). Cosmetic; can be settled during implementation without changing the specs or tasks.
