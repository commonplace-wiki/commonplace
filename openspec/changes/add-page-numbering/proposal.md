# Proposal

## Why

Wiki pages have no visible position identifier, so pointing someone at "the third page under Getting Started" is imprecise, and a page's location is hard to reference in docs, issues, or conversation. A hierarchical number (1, 1.1, 1.1.1) that mirrors the sidebar tree gives every page and folder a stable, human-friendly reference without adding any new data to the repository.

## What Changes

- Derive a hierarchical section number for every sidebar node — both pages and folders — from its position in the navigation tree.
- Display the number next to each label in the sidebar.
- Display the number next to the page title in the page view, including the directory/index view.
- Renumber automatically whenever the sidebar order changes (drag & drop) or pages are added, removed, moved, or renamed. Numbers are never stored or edited by hand.
- Numbering is per level: a node's number is `<parent number>.<position>`; top-level nodes start at `1`. The position follows the existing sidebar sort (`.commonplace/order.yaml` first, then title).
- Nodes that are not part of the numbered navigation (the home link, the knowledge graph link, filtered search results, and pages hidden from the nav) are out of scope for numbering.

## Capabilities

### New Capabilities
- `wiki-navigation`: Deriving and displaying hierarchical section numbers for the wiki navigation tree and page titles, kept in sync with the sidebar order.

### Modified Capabilities
<!-- None: no existing specs, and no existing spec-level behavior changes. -->

## Impact

- `components/Sidebar.tsx`: compute numbers while building the tree and render them on directory and page rows.
- `app/(wiki)/[[...path]]/WikiPage.tsx`: show the number alongside the page and directory titles.
- `components/Shell.tsx`: expose numbering to the page view (via the existing wiki context) if the tree computation is shared.
- No API, data-format, or frontmatter changes: `.commonplace/order.yaml` stays the single source of ordering and OKF frontmatter is untouched.
