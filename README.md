# Commonplace

A wiki for [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundles: every page is a markdown file with YAML frontmatter in your GitHub repository, and every save is a commit. There is no database; every read goes through the GitHub API with your own credentials.

## Features

- **GitHub sign-in**: GitHub App or OAuth web flow (or a personal access token as fallback). The app never sees credentials beyond the token, which is kept in an encrypted, httpOnly session cookie; expiring GitHub App tokens are refreshed automatically.
- **Repository picker**: choose any repo, branch, and optional subdirectory as the OKF bundle root.
- **Public wikis**: when the configured repository is public, visitors can read every page without signing in. Edit actions appear after they sign in.
- **Viewer**: renders concept documents with their frontmatter (type badge, tags, resource URI, timestamp), resolves bundle-relative links (`/tables/customers.md`) and relative links between pages, and serves images and attachments from the repo through your token.
- **Directory pages**: renders `index.md` when present, otherwise synthesizes a listing, as the spec allows.
- **Editor**: structured frontmatter form (`type`, `title`, `description`, `resource`, `tags`) with unknown producer extension keys preserved round-trip, a markdown body editor with live preview, and custom commit messages. `timestamp` is set automatically on save.
- **Formatting toolbar**: bold, italic, strikethrough, headings, quotes, bullet/numbered/task lists, inline code and code blocks, links, wiki page links, horizontal rules, and a table generator (pick rows and columns). Shortcuts: Cmd/Ctrl+B, +I, +K.
- **Image and attachment upload**: drag & drop, paste, or pick files in the editor. Files are committed to an `assets/` folder next to the page (5 MB max, name collisions get a suffix) and inserted as bundle-absolute links; the viewer serves them through your token, so this works for private repos.
- **OKF conformance**: `type` is required for concept documents; `index.md` and `log.md` are treated as reserved files without frontmatter; page creations, updates, and deletions are recorded in the bundle root `log.md` (newest-first, grouped by date) unless you opt out per save.

## Setup

```bash
npm install
cp .env.example .env.local
```

Create a GitHub App at https://github.com/settings/apps/new (recommended) with:

- Homepage URL: `http://localhost:3000`
- Callback URL: `http://localhost:3000/api/auth/callback`
- Webhook: unchecked
- Repository permissions: Contents read and write (Metadata read-only is added automatically)

Then install the app on the wiki repository (App settings → Install App). Users get a minimal one-click consent screen, and their tokens can only reach repositories the app is installed on. A classic OAuth App (https://github.com/settings/developers, same callback URL) also works, but its `repo` scope covers every repository the user can access, so GitHub shows a much broader consent screen. The app detects which kind you configured from the client ID (`Iv…` = GitHub App, `Ov…` = OAuth App).

Put the client ID and a generated client secret into `.env.local`, along with a random `SESSION_SECRET` (`openssl rand -hex 32`).

For a deployed (team-facing) wiki, pin the repository with `WIKI_REPO=https://github.com/owner/repo` (plus optional `WIKI_BRANCH` and `WIKI_ROOT`). The URL's host determines the provider; currently only `github.com` is supported (bare `owner/repo` still works as a GitHub shorthand). The repo picker disappears, users land directly on the wiki after signing in, and pages are served from the root path (`/how_to/onboarding.md`). If the pinned repository is public, visitors can read the wiki without signing in; edit actions appear once they use the "Sign in" button. Without `WIKI_REPO`, each user picks a repository at `/login` and the choice is stored in a cookie.

If you skip the GitHub App setup entirely, you can still sign in with a personal access token: a fine-grained token with Contents read/write on the wiki repository (recommended), or a classic token with `repo` scope.

## Run

```bash
npm run dev
```

Open http://localhost:3000 and sign in. If no `WIKI_REPO` is pinned, pick the repository that holds (or should hold) your knowledge bundle. Start writing.

## How content is stored

Every page is a markdown file:

```markdown
---
type: Playbook
title: Customer churn playbook
description: How to react when churn spikes.
tags: [ops, retention]
timestamp: 2026-07-18T09:30:00.000Z
---

## When to use this

...
```

Links between pages use bundle-relative paths (`[customers](/tables/customers.md)`) or normal relative paths. Saving a page commits it to the configured branch; concurrent edits are detected via the file's blob SHA and reported instead of silently overwritten.
