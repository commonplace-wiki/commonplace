# Proposal

## Why

The sidebar can reorder pages among their siblings by drag & drop, but it cannot change a page's nesting level. Building or fixing a hierarchy currently means opening the page and using the editor's move form, which is slow and easy to get wrong. Indent/outdent controls make hierarchy a one-click sidebar action, and the section numbers stay correct because they follow the tree.

## What Changes

- Add indent (`>` / `→`) and outdent (`<` / `←`) controls to sidebar rows, for pages and folders alike.
- **Indent**: move the selected node (with its whole subtree) so it becomes the last child of the immediately preceding sibling.
  - If the preceding sibling is a folder, the node moves into it.
  - If the preceding sibling is a plain page, that page becomes the folder's own page (a merged page + directory node, Confluence-style) and the node moves into the new directory. The preceding page is not otherwise changed.
  - The first sibling of a group cannot be indented.
- **Outdent**: move the selected node (with its whole subtree) up to its parent's level, placed immediately after its former parent. A top-level node cannot be outdented.
- Move folders as a unit: indenting or outdenting a folder carries all of its descendants.
- Show the controls on every row on hover and keep them visible on the active page's row, so both placements can be evaluated.
- Disable a control when it is not possible (no preceding sibling, already top level), when the user lacks write access, or while a move is in flight.
- Reuse the existing move pipeline (`POST /api/move`): a move is one commit that rewrites links inside the moved files, keeps `.commonplace/order.yaml` in step, and appends a `Move` entry to `log.md`. Folders without their own page must also be movable.
- Section numbers follow the new hierarchy automatically (their display is delivered by the separate `add-page-numbering` change).

## Capabilities

### New Capabilities
- `page-hierarchy`: Changing a page's or folder's nesting level in the wiki navigation tree by moving it into or out of folders, including promoting a page to a folder parent and carrying whole subtrees.

### Modified Capabilities
<!-- None: the pending wiki-navigation capability only covers numbering display, which this change does not alter. -->

## Impact

- `components/Sidebar.tsx`: render the indent/outdent controls, compute the destination, call the move endpoint, and refresh the tree.
- `app/api/move/route.ts` and `lib/repo.ts` (`movePaths`): allow moving a folder that has no page of its own, in addition to the existing page/subtree move.
- `app/globals.css`: styles for the row controls and their disabled state.
- No data-format change: still one commit per move through the existing API, and `.commonplace/order.yaml` remains the single source of ordering. Section numbering is unaffected and, once enabled, follows the new structure.
