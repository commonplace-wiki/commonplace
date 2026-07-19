# Commonplace

An open-source wiki and Confluence alternative.

Idea: Keep your knowledge in a Git repository, following [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md). Commonplace acts as a nice UI.


## Features

- **Beautiful UI**: A familiar look and feel, but less bloated.
- **Just a frontend**: Commonplace is a stateless frontend. Everything is persisted in your Git repository.
- **GitHub permissions**: Using the GitHub login and permission model, you control who has read and write access to the wiki. Support for public and private repos.
- **Open Knowledge Format**: Google's universal format to collect knowledge and relationships.
- **Markdown Editor**: A nice editor with just the right feature set. Good support for code snippets, drag & drop, screenshots and rich formatting. Files are committed to an `assets/` folder next to the page.
- **MCP server**: `/api/mcp` lets AI agents search, read, and write wiki pages and relationships to serve as the business knowledge for your agents.
- **Confluence Migration Skill**: Ask your coding agent to run the [confluence-to-commonplace skill](.claude/skills/confluence-to-commonplace/SKILL.md) to migrate a Confluence space into your wiki.

## Local Setup

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

Point the deployment at the wiki repository with `GIT_REPO=https://github.com/owner/repo` (plus optional `GIT_BRANCH` and `GIT_ROOT` for a subdirectory). The URL's host determines the provider; currently only `github.com` is supported (bare `owner/repo` works as a GitHub shorthand). Each deployment serves exactly one repository, and pages are served from the root path (`/how_to/onboarding.md`). If the repository is public, visitors can read the wiki without signing in; edit actions appear once they use the "Sign in" button.

If you skip the GitHub App setup entirely, you can still sign in with a personal access token: a fine-grained token with Contents read/write on the wiki repository (recommended), or a classic token with `repo` scope.

## Run

```bash
npm run dev
```

Open http://localhost:3000 and sign in. Start writing.

## Docker

```bash
docker run -p 3000:3000 \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e GIT_REPO=https://github.com/owner/repo \
  -e GITHUB_CLIENT_ID=... \
  -e GITHUB_CLIENT_SECRET=... \
  commonplacewiki/commonplace
```

All configuration is passed as environment variables at runtime; nothing is baked into the image. To build the image yourself: `docker build -t commonplace .`

## MCP server (AI agents)

The deployment exposes an MCP server (Streamable HTTP) at `/api/mcp` with three tools: `search_pages` (content, title, tag, and type search), `get_page` (frontmatter, body, and the blob sha), and `save_page` (create or update as a git commit, with required `type`, automatic `timestamp`, a `log.md` entry, and sha-based conflict detection).

Authenticate with a GitHub token in the `Authorization` header; reads work without a token when the wiki repository is public. For Claude Code:

```bash
claude mcp add --transport http wiki http://localhost:3000/api/mcp \
  --header "Authorization: Bearer github_pat_…"
```

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
