# Tasks

## 1. Move API: folders and destination order

- [x] 1.1 Generalize `POST /api/move` to accept a node whose `path` does not end in `.md`, treating it as a folder and issuing a single subtree move; verify `npm run typecheck` passes and a manual request moving a folder-only node relocates all of its descendants.
- [x] 1.2 Generalize the subtree computation in `app/api/move/route.ts` and `syncOrderAfterMove` so `.md` is stripped only for page paths and the directory itself is used for folders; verify a page move and a folder move both update `.commonplace/order.yaml` correctly.
- [x] 1.3 Add an optional `order: { dir, children }` field to the move payload and apply it during the order sync; verify the destination directory's entry equals the provided child list after a move.
- [x] 1.4 Keep the "cannot move below its own subpages" guard correct for folder paths; verify moving a folder into its own descendant is rejected with a 400.
- [x] 1.5 Update the route's doc comment to describe folder moves and the `order` field; verify the comment matches the implemented request shape.

## 2. Sidebar controls

- [x] 2.1 Add an outdent/indent button pair to each `tree-row` in `components/Sidebar.tsx`, hidden until the row is hovered or focused and always visible on the active page's row; verify in `npm run dev` that hovering reveals them and the active row keeps them.
- [x] 2.2 Compute the destination directory and the destination child order for indent and outdent from the rendered tree (last child for indent, immediately after the former parent for outdent); verify with a node whose preceding sibling is a plain page and one whose preceding sibling is a folder.
- [x] 2.3 Wire the buttons to `POST /api/move` with an optimistic order override, a per-row saving state, and rollback on failure; verify a successful move lands in the new position and a forced failure restores the previous tree and shows an error.
- [x] 2.4 Disable the controls when a node is the first sibling, when it is top level, when the user lacks write access (`me.canWrite === false`), and while a move is in flight; verify each case disables the expected button.
- [x] 2.5 Add a feature bullet about moving pages into and out of folders from the sidebar to `README.md`; verify the wording matches the shipped behavior.

## 3. Styling

- [x] 3.1 Style the controls in `app/globals.css` (hover/focus reveal, active-row visibility, disabled state, and alignment with the tree); verify visually with deep nesting and a narrow sidebar that rows stay aligned and the controls do not overlap the label.

## 4. Integration

- [x] 4.1 Verify indenting and outdenting a folder with pages and subfolders moves the whole tree unchanged and that bundle-absolute links inside the moved files still resolve.
- [x] 4.2 Verify the moved node's section number matches its new position once the `add-page-numbering` change is applied; note the dependency if it is not yet implemented.

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived result and that `openspec/specs/page-hierarchy/spec.md` was created with the requirements.
- Separately propose the bilingual OpenSpec-artifacts change the user asked for.
