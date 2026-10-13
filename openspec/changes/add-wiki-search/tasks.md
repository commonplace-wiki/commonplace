# Tasks

## 1. Search core (`lib/search.ts`)

- [x] 1.1 Add a case-insensitive matcher, a snippet extractor around the first match, and a result assembler; verify with a Node unit test covering a body match, a case-insensitive match, snippet bounds, and a no-match.
- [x] 1.2 Add a scope helper that decides whether a file path belongs to a page's subtree (the page itself and everything under it); verify with a unit test for the page itself, a descendant, and a sibling path.

## 2. Search API (`app/api/search/route.ts`)

- [x] 2.1 Implement `GET` with `q`, `scope` (`repo` | `page`), and `path`; exclude hidden pages and `log.md`/`README.md`; cap results and set `truncated`; verify with `curl` against the local dev wiki that `scope=repo` returns matches and `scope=page` limits them to the subtree.
- [x] 2.2 Add the short-lived in-process corpus cache; verify a second identical request within the TTL returns the same results without re-reading the provider.
- [x] 2.3 Map provider errors like the tree/graph routes (`401` → sign-in required, `429` → rate limit) and return the documented JSON shape; verify each response with `curl`.

## 3. Search UI

- [x] 3.1 Add `components/SearchPanel.tsx` and a top-bar button in `components/Shell.tsx`; open with the button and `Cmd/Ctrl+K`, close with `Esc`; verify in `npm run dev`.
- [x] 3.2 Add the scope selector, persisted in `localStorage`, disabled when no page is open; verify the choice is remembered after reopening the panel.
- [x] 3.3 Render results (title, path, highlighted snippet), navigate on select, and show the truncation note; verify that selecting a result opens the page and closes the panel.

## 4. Styling and docs

- [x] 4.1 Style the panel, results, and scope selector in `app/globals.css`; verify the panel stays usable at a narrow width.
- [x] 4.2 Add a search feature bullet to `README.md`; verify the wording matches the shipped behavior.

## 5. Integration

- [x] 5.1 Verify both scopes end-to-end against the local dev wiki: a match in the open page's subpages is found under "This page", and a match in another section only under "Whole wiki".
- [x] 5.2 Verify an empty query issues no request, a hidden page is excluded, and a truncated result set shows the note.

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- The completed `add-page-numbering` and `add-sidebar-indent-outdent` changes can be archived too.
