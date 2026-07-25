# Commonplace

An open-source wiki, knowledge base and Confluence alternative, based on a Git repository following [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md), with a nice UI.

Documentation: [commonplace.wiki](https://www.commonplace.wiki) (itself a Commonplace wiki)


## Features

- **Beautiful UI**: A familiar look and feel, but less bloated.
- **Just a frontend**: Commonplace is a stateless frontend. Everything is persisted in your Git repository.
- **GitHub and GitLab**: Works with repositories on github.com, gitlab.com, or a self-hosted GitLab. The provider's login and permission model controls who has read and write access to the wiki. Support for public and private repos.
- **Open Knowledge Format**: Google's universal format to collect knowledge and relationships.
- **Markdown Editor**: A nice editor with just the right feature set. Good support for code snippets, drag & drop, screenshots and rich formatting. Files are committed to an `assets/` folder next to the page.
- **Knowledge Graph**: An interactive graph of all pages, connected by the links between them and the folder structure.
- **MCP server**: `/api/mcp` lets AI agents search, read, and write wiki pages and relationships to serve as the business knowledge for your agents.
- **Confluence Migration Skill**: Ask your coding agent to run the [confluence-to-commonplace skill](.claude/skills/confluence-to-commonplace/SKILL.md) to migrate a Confluence space into your wiki.

## Try locally

The fastest way to try Commonplace, no accounts and no sign-in setup:

```bash
wiki=$(mktemp -d) && git init -q "$wiki" && echo "Wiki repository: $wiki"
docker run -p 3000:3000 \
  -v "$wiki":/wiki -e GIT_REPO=/wiki \
  commonplacewiki/commonplace
```

Open http://localhost:3000. The "Sign in" button works immediately, and every saved page becomes a git commit in `$wiki`. To keep the wiki, use a folder of your choice instead of the temp directory.

## Quickstart (GitHub)

The production setup: the wiki lives in a GitHub repository, and every edit is a commit by a signed-in GitHub user.

```bash
docker run -p 3000:3000 \
  -e GIT_REPO=https://github.com/owner/repo \
  -e GITHUB_CLIENT_ID=... \
  -e GITHUB_CLIENT_SECRET=... \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  commonplacewiki/commonplace
```

The client ID and secret belong to a GitHub App. The wizard at [commonplace.wiki/setup](https://www.commonplace.wiki/setup) creates it in one click and hands you this environment fully filled in — the credentials are converted directly in your browser and never touch that server. The same wizard runs on your own deployment at `/setup`.

If the repository is public, the wiki is readable without signing in; reading a private repository and editing require it. Sign-in also works without an app, using a personal access token with Contents read/write. To see Commonplace with content in it, use `GIT_REPO=https://github.com/commonplace-wiki/knowledgebase`, the repository behind the live docs at [commonplace.wiki](https://www.commonplace.wiki).

All configuration is passed as environment variables at runtime; nothing is baked into the image (`docker build -t commonplace .` to build it yourself).

For GitLab wikis (gitlab.com or self-hosted), see the [GitLab guide](https://www.commonplace.wiki/Git-Repositories/gitlab.md). Additional installation methods, such as [Kubernetes](https://www.commonplace.wiki/Installation/install-on-kubernetes.md), [Azure](https://www.commonplace.wiki/Installation/install-on-azure.md), and [Vercel](https://www.commonplace.wiki/Installation/install-on-vercel.md), are covered in the [Installation docs](https://www.commonplace.wiki/Installation).

## Local Setup (from source)

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

## Run

```bash
npm run dev
```

Open http://localhost:3000 and sign in. Start writing.

## MCP server (AI agents)

The deployment exposes an MCP server (Streamable HTTP) at `/api/mcp` with three tools: `search_pages` (content, title, tag, and type search), `get_page` (frontmatter, body, and the blob sha), and `save_page` (create or update as a git commit, with required `type`, automatic `timestamp`, a `log.md` entry, and sha-based conflict detection).

Authenticate with a GitHub or GitLab token in the `Authorization` header; reads work without a token when the wiki repository is public. For Claude Code:

```bash
claude mcp add --transport http wiki http://localhost:3000/api/mcp \
  --header "Authorization: Bearer github_pat_…"
```
