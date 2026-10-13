# Proposal

## Why

The wiki can only filter the sidebar by title and path; there is no way to find where a term is mentioned inside page content. A search with a scope — the current page and its subpages, or the whole repository — lets a reader check a section quickly and find knowledge anywhere in the wiki.

## What Changes

- Add a search button to the top bar that opens a search panel (also opened with `Cmd/Ctrl+K` and closed with `Esc`).
- The panel has a scope selector: **This page** (the current page and its subpages) or **Whole wiki**, remembered per user.
- Search is full-text and case-insensitive over page content; results show the page title, its path, and a snippet with the match highlighted.
- Selecting a result opens that page and closes the panel.
- Hidden pages and reserved files (`log.md`, `README.md`) are excluded from results.
- The existing sidebar "Filter pages…" box is unchanged.
- Search is read-only: no repository data, frontmatter, or API payload shape changes.

## Capabilities

### New Capabilities
- `wiki-search`: Searching wiki page content within a scope (the current page's subtree or the whole repository) and presenting navigable results.

### Modified Capabilities
<!-- None: this adds a new capability and does not change existing spec-level behavior. -->

## Impact

- New `app/api/search/route.ts`, reusing `listMarkdownFiles` + `fetchFileTexts` the same way `app/api/graph/route.ts` does.
- New `components/SearchPanel.tsx`; a search button and keyboard shortcut in `components/Shell.tsx`.
- New `lib/search.ts` with pure matching and snippet helpers.
- `app/globals.css` styles for the panel; a `README.md` feature bullet.
