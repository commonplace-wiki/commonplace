# Design

## Context

See `proposal.md` — Why. Relevant current state:

- `app/api/graph/route.ts` already reads the whole bundle: `listMarkdownFiles` for the paths and `fetchFileTexts` for every page's text, then parses each with `parseConcept`. It excludes `log.md`, `README.md`, and pages tagged `hidden`. This is the exact pattern a whole-repository search reuses.
- `components/Sidebar.tsx` has a client-side "Filter pages…" box that matches only title/path against the `files` list from `/api/tree`; it has no access to page bodies.
- `components/Shell.tsx` renders the top bar (brand, "+ New page", user menu) and already derives the current path from `pathname`.
- `lib/pageCache.ts` caches only pages the user has visited, so it cannot back a repository-wide search.
- `lib/repo.ts` exposes provider-agnostic `listMarkdownFiles` and `fetchFileTexts` (GitHub, GitLab, local, mirror).

## Goals / Non-Goals

**Goals:**
- One search path that serves both scopes with identical matching semantics.
- Keep page bodies on the server (do not ship the whole corpus to the browser).
- Reuse existing provider plumbing and error handling.
- A pure, testable matcher/snippet module.

**Non-Goals:**
- Changing the sidebar filter or the editor's link search.
- Indexing, ranking, stemming, fuzzy matching, or persistent search state.
- Server-side persistence of the scope preference (it is a per-user client preference).

## Decisions

### Decision: A server-side `/api/search` endpoint
`GET /api/search?q=<query>&scope=repo|page&path=<bundlePath>` returns `{ results: [{ path, title, snippet }], truncated }`. It reuses `listMarkdownFiles` + `fetchFileTexts` exactly like the graph route.

*Alternatives considered:* a client-side corpus (rejected — ships every page body to the browser and duplicates what the server already does); one `/api/file` request per candidate page (rejected — N round-trips).

### Decision: Compute the scope server-side from `path`
For `scope=page`, the subtree base is `path` without a trailing `.md`; a file is in scope when its path equals the page path or starts with `<base>/`. For `scope=repo`, every file is in scope. Computing this on the server keeps the client from having to trust/duplicate the subtree rule.

*Alternatives considered:* sending an explicit list of paths from the client (rejected — more payload, and the client would need to recompute the subtree anyway).

### Decision: A short-lived in-process corpus cache
Cache the `{ files, texts }` corpus per repository for a short TTL (e.g. 30 s) so typing does not refetch every page on each keystroke, and debounce queries on the client (~250 ms). The graph route does no caching, but search is interactive, so the cost profile differs.

*Alternatives considered:* no cache (rejected — a GitHub repo refetch per keystroke is wasteful and can trip rate limits); a persistent index (rejected — the app is stateless by design and this is out of scope).

### Decision: Pure helpers in `lib/search.ts`
Matching (case-insensitive substring), snippet extraction around the first match, and result assembly live in a pure module with no I/O, so they are unit-testable without a repository.

### Decision: Exclusions mirror the graph
Hidden pages (`tags: hidden`) and `log.md` / `README.md` are excluded. `index.md` stays searchable as a page.

### Decision: UI as a modal panel driven from the top bar
`components/SearchPanel.tsx` is a `role="dialog"` overlay rendered by `Shell`, opened by a top-bar button and by `Cmd/Ctrl+K`, closed by `Esc`. It holds the input, the scope selector, and the results list. The scope is stored in `localStorage` (`okf_search_scope`) and read on mount.

The current page path is derived from `pathname` the same way `Sidebar` does it. "This page" is disabled on views without a page (home/root, `/graph`, `/settings`); the panel then defaults to "Whole wiki".

Selecting a result calls the router to navigate to `/${path}` and closes the panel. Error states map `401` to a "sign in to search" message and `429` to a rate-limit message, consistent with `/api/tree` and the graph.

### Decision: Bounded results
The endpoint returns at most a fixed number of results (e.g. 50) and sets `truncated` when more pages matched. The panel shows a note when truncated. An empty/whitespace query never issues a request.

## Risks / Trade-offs

- [Interactive search refetches a large repo] → Corpus cache + client debounce + bounded results; the graph route already tolerates full reads.
- [Shipping a big result set] → Results are capped and carry short snippets, not full bodies.
- [`Cmd/Ctrl+K` may clash with an editor shortcut] → Bind it at the Shell level and `preventDefault`; if the editor claims it later, the top-bar button still opens the panel.
- [Local/private repositories and access] → Reuse the tree/graph error mapping so private repos ask for sign-in and quotas surface clearly.
- [Snippet quality] → Snippet is plain text around the first match; highlighting is done client-side by matching the query, so no markup is injected server-side.

## Migration Plan

No data migration. Additive: a new endpoint, a new component, a top-bar control, and styles. Roll back by reverting the commit; nothing is persisted server-side.

## Open Questions

- Exact result cap and snippet length (cosmetic; settle during implementation).
