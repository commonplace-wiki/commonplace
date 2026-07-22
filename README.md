# Commonplace

An open-source wiki and Confluence alternative.

Idea: Keep your knowledge in a Git repository, following [Open Knowledge Format (OKF)](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md). Commonplace acts as a nice UI.


## Features

- **Beautiful UI**: A familiar look and feel, but less bloated.
- **Just a frontend**: Commonplace is a stateless frontend. Everything is persisted in your Git repository.
- **GitHub and GitLab**: Works with repositories on github.com, gitlab.com, or a self-hosted GitLab. The provider's login and permission model controls who has read and write access to the wiki. Support for public and private repos.
- **Open Knowledge Format**: Google's universal format to collect knowledge and relationships.
- **Page ordering**: Drag pages in the sidebar to reorder them. The order is stored in `.commonplace/order.yaml`; pages not listed there sort alphabetically.
- **Markdown Editor**: A nice editor with just the right feature set. Good support for code snippets, drag & drop, screenshots and rich formatting. Files are committed to an `assets/` folder next to the page.
- **MCP server**: `/api/mcp` lets AI agents search, read, and write wiki pages and relationships to serve as the business knowledge for your agents.
- **Confluence Migration Skill**: Ask your coding agent to run the [confluence-to-commonplace skill](.claude/skills/confluence-to-commonplace/SKILL.md) to migrate a Confluence space into your wiki.

## Local Setup

```bash
npm install
cp .env.example .env.local
```

Create a GitHub App for sign-in. The easy way: start the app (`npm run dev`) and open http://localhost:3000/setup — it creates the app on GitHub with the right settings in one click and shows you the credentials. Manually instead: https://github.com/settings/apps/new with

- Homepage URL: `http://localhost:3000`
- Callback URL: `http://localhost:3000/api/auth/callback`
- Webhook: unchecked
- Repository permissions: Contents read and write (Metadata read-only is added automatically)
- Organization permissions: Members read-only (optional; lets @-mentions list everyone in the organization instead of just the repository's collaborators)

Then install the app on the wiki repository (App settings → Install App).

Put the client ID and a generated client secret into `.env.local`, along with a random `SESSION_SECRET` (`openssl rand -hex 32`).

Point the deployment at the wiki repository with `GIT_REPO=https://github.com/owner/repo` (plus optional `GIT_BRANCH` and `GIT_ROOT` for a subdirectory). The URL's host determines the provider: `github.com` or `gitlab.com` (bare `owner/repo` works as a GitHub shorthand; for a self-hosted GitLab, additionally set `GIT_PROVIDER=gitlab`). Each deployment serves exactly one repository, and pages are served from the root path (`/how_to/onboarding.md`). If the repository is public, visitors can read the wiki without signing in; edit actions appear once they use the "Sign in" button.

If you skip the GitHub App setup entirely, you can still sign in with a personal access token: a fine-grained token with Contents read/write on the wiki repository (recommended), or a classic token with `repo` scope.

### GitLab

For a GitLab wiki repository, create an OAuth application instead (User or Group Settings → Applications, or open `/setup` for guided instructions): redirect URI `http://localhost:3000/api/auth/callback`, scope `api`, confidential. Put the credentials into `GITLAB_CLIENT_ID` and `GITLAB_CLIENT_SECRET`. Personal access tokens with `api` scope also work for sign-in. Editing requires at least the Developer role on the project.

### Local repository (demos, offline)

Point `GIT_REPO` at an absolute directory path instead of a URL:

```bash
GIT_REPO=/path/to/wiki
```

No sign-in setup is needed: the "Sign in" button creates a session for your local git identity (`git config user.name`) directly. Every save is committed to the repository, so history stays intact; if the directory is not a git repository, the wiki still works and simply skips commits. This mode serves files from the server's own disk, so use it locally, not for shared deployments.

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

For a local repository, mount it into the container: `-v /path/to/wiki:/wiki -e GIT_REPO=/wiki` (no client ID/secret needed).

## MCP server (AI agents)

The deployment exposes an MCP server (Streamable HTTP) at `/api/mcp` with three tools: `search_pages` (content, title, tag, and type search), `get_page` (frontmatter, body, and the blob sha), and `save_page` (create or update as a git commit, with required `type`, automatic `timestamp`, a `log.md` entry, and sha-based conflict detection).

Authenticate with a GitHub or GitLab token in the `Authorization` header; reads work without a token when the wiki repository is public. For Claude Code:

```bash
claude mcp add --transport http wiki http://localhost:3000/api/mcp \
  --header "Authorization: Bearer github_pat_…"
```
