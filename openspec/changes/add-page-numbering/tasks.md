# Tasks

## 1. Shared numbering module

- [x] 1.1 Move `buildTree`, `Node`, `orderKey`, and `pretty` out of `components/Sidebar.tsx` into a shared module `lib/nav.ts`, and update `Sidebar.tsx` to import them; verify `npm run typecheck` passes and the sidebar still renders the tree.
- [x] 1.2 Add a `number` field to `Node` and assign numbers while building the ordered tree (top-level nodes `1..n`, a child `<parent>.<position>`); verify by loading a wiki with a nested page and confirming the tree yields `1`, `1.1`, `1.1.1` for the expected nodes.
- [x] 1.3 Add a `numberByPath(nodes)` helper returning a `Map<string, string>` from each node's `path` — and its `pagePath` for a merged folder/page — to its number; verify a folder merged with a same-named page resolves both paths to a single number.

## 2. Sidebar display

- [x] 2.1 Render each node's number in its own muted element before the label on both folder and page rows in `Sidebar.tsx`; verify in `npm run dev` that numbers show next to labels and renumber immediately after a drag & drop reorder.
- [x] 2.2 Confirm non-navigational entries carry no number (home link, knowledge graph link, filtered search results) and that hidden or reserved pages (`index.md`, `log.md`, `README.md`) are excluded; verify by tagging a page hidden and by typing a search query.

## 3. Page and directory titles

- [x] 3.1 Compute the path → number lookup once in `components/Shell.tsx` from the committed `files` and `order` (memoized) and expose it through `WikiContext`; verify `npm run typecheck` passes and the value is available to consumers via `useWiki()`.
- [x] 3.2 Show the number before the title in `FileView` and in `DirectoryView` in `app/(wiki)/[[...path]]/WikiPage.tsx`; verify a nested page and its folder both display the same number the sidebar shows (e.g. `1.1.2`).

## 4. Integration, styling, and docs

- [x] 4.1 Verify numbers stay in sync across add, rename, move, and delete operations (each calls `refreshTree()`); observe that numbers update after every operation without any number being written to the repository.
- [x] 4.2 Verify sidebar and title layout with deep nesting and long numbers; adjust the number styles in `app/globals.css` (and the chosen separator) so rows and titles stay aligned.
- [x] 4.3 Add a short feature bullet about hierarchical page numbering to `README.md`; verify the wording matches the shipped behavior and the file renders correctly.

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived result and that `openspec/specs/wiki-navigation/spec.md` was created with the requirements.
