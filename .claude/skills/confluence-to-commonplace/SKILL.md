---
name: confluence-to-commonplace
description: Migrate a Confluence Cloud space to a Commonplace wiki (Open Knowledge Format bundle) stored in a GitHub repository. Use when the user wants to export, convert, or migrate a Confluence space (or its pages) to markdown, OKF, or a GitHub-backed wiki.
---

# Migrate a Confluence space to an OKF wiki

This skill converts a Confluence Cloud space into an OKF v0.1 bundle (markdown files with YAML frontmatter, per https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) and pushes it to a GitHub repository.

## Inputs to collect

1. **Confluence site URL**, e.g. `https://acme.atlassian.net`
2. **Space key**, e.g. `ED` (visible in the space URL: `/wiki/spaces/<KEY>/`)
3. **Target GitHub repository** (`owner/repo`) and branch; optionally a subdirectory as bundle root
4. **Confluence credentials**, in order of preference:
   - Atlassian CLI: if `acli` is authenticated for the site (`acli jira auth status` or
     `acli confluence auth status`), the script reuses its stored API token from the OS
     keyring automatically (macOS only). Have the user run
     `acli confluence auth login --site <host> --email <email> --token` if not.
     An Atlassian API token is account-wide, so a Jira login also grants Confluence API access.
   - Otherwise: an API token (https://id.atlassian.com/manage-profile/security/api-tokens)
     via `CONFLUENCE_EMAIL` and `CONFLUENCE_API_TOKEN` env vars, or `--email` and
     `--token-file <path>` flags. Never echo the token.

## Steps

1. Ensure dependencies: `python3 -m pip install --user requests markdownify` (markdownify pulls in beautifulsoup4).
2. Clone the target repository into a scratch directory (`gh repo clone owner/repo`). Decide with the user whether to write into the repo root or a subdirectory, and whether existing content may be overwritten.
3. Run the migration script from this skill's directory:

   ```bash
   python3 scripts/migrate.py \
     --site https://acme.atlassian.net \
     --space ED \
     --out /path/to/clone \
     --email user@acme.com \
     --token-file ~/.confluence_token \
     --type "Wiki Page"
   ```

   What it does:
   - Fetches every current page of the space via the Confluence REST API v2 (paginated), plus labels and attachments per page.
   - Maps the page hierarchy to directories: a page becomes `<slug>.md`; its children live in `<slug>/`. The space homepage is flattened to `overview.md` at the bundle root.
   - Converts storage-format XHTML to markdown, handling code macros (fenced blocks with language), info/note/warning/tip panels (blockquotes), task lists (checkboxes), expand/status/toc macros, tables, emoticons, and user mentions.
   - Rewrites page-to-page links to bundle-absolute markdown links (`/a/b.md`); unresolved links fall back to the original Confluence URL and are reported.
   - Downloads attachments into `<pagedir>/assets/` and rewrites image/attachment references.
   - Writes OKF frontmatter per page: `type` (from `--type`), `title`, `description` (first paragraph, truncated), `tags` (Confluence labels), `timestamp` (last version date), and `confluence_id` as a producer extension key for traceability. No `resource` link back to Confluence is kept.
   - Generates a root `index.md` (with `okf_version: "0.1"`) listing the top-level pages, and a `log.md` recording the migration.
4. Review the script's summary output: page/attachment counts and warnings (unresolved links, failed downloads, skipped macros). Spot-check 2-3 converted pages against the originals, including one with a table or image.
5. Show the user the result (file listing plus a sample page) and confirm before pushing. Then commit and push:

   ```bash
   git -C /path/to/clone add -A && git -C /path/to/clone commit -m "Migrate Confluence space <KEY> to OKF" && git -C /path/to/clone push
   ```
6. If an OKF wiki app is configured, point it at the repository so the user can browse the result.

## Notes

- Re-running the script overwrites previously migrated files (idempotent for unchanged pages); it never deletes files it did not generate.
- Archived and draft pages are skipped; only `current` pages migrate.
- Confluence comments, page restrictions, and version history are not migrated (git history starts fresh).
