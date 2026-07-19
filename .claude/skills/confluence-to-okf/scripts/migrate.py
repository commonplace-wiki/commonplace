#!/usr/bin/env python3
"""Migrate a Confluence Cloud space to an OKF (Open Knowledge Format) bundle.

Fetches all current pages of a space via the Confluence REST API v2, converts
storage-format XHTML to markdown, downloads attachments, and writes an OKF v0.1
bundle (markdown + YAML frontmatter) into an output directory.
"""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup, Comment, NavigableString
from markdownify import markdownify

WARNINGS = []


def warn(message):
    WARNINGS.append(message)
    print(f"  ! {message}", file=sys.stderr)


def slugify(title):
    slug = title.lower().strip()
    slug = re.sub(r"[äöüß]", lambda m: {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}[m.group(0)], slug)
    slug = re.sub(r"[^a-z0-9._-]+", "_", slug)
    slug = re.sub(r"_+", "_", slug).strip("._-")
    return slug or "page"


def yaml_str(value):
    # JSON strings are valid YAML scalars, which spares us a YAML dependency.
    return json.dumps(value, ensure_ascii=False)


class Confluence:
    def __init__(self, site, email, token):
        self.site = site.rstrip("/")
        self.session = requests.Session()
        self.session.auth = (email, token)
        self.session.headers["Accept"] = "application/json"

    def get(self, path, **params):
        url = path if path.startswith("http") else self.site + path
        res = self.session.get(url, params=params or None, timeout=60)
        res.raise_for_status()
        return res.json()

    def paged(self, path, **params):
        """Iterate a v2 collection, following cursor pagination."""
        url = self.site + path
        while True:
            res = self.session.get(url, params=params, timeout=60)
            res.raise_for_status()
            data = res.json()
            for item in data.get("results", []):
                yield item
            next_link = data.get("_links", {}).get("next")
            if not next_link:
                return
            url = self.site + next_link
            params = None

    def download(self, download_link, target, max_bytes=25 * 1024 * 1024):
        url = self.site + "/wiki" + download_link if download_link.startswith("/") else download_link
        with self.session.get(url, stream=True, timeout=120) as res:
            res.raise_for_status()
            target.parent.mkdir(parents=True, exist_ok=True)
            written = 0
            with open(target, "wb") as fh:
                for chunk in res.iter_content(65536):
                    written += len(chunk)
                    if written > max_bytes:
                        raise ValueError("attachment exceeds size limit")
                    fh.write(chunk)


def cdata_text(element):
    """Extract text from ac:plain-text-body, where CDATA shows up as a comment node."""
    if element is None:
        return ""
    parts = []
    for node in element.contents:
        if isinstance(node, Comment):
            text = str(node)
            if text.startswith("CDATA["):
                text = text[len("CDATA["):]
            if text.endswith("]]"):
                text = text[:-2]
            parts.append(text)
        elif isinstance(node, NavigableString):
            parts.append(str(node))
        else:
            parts.append(node.get_text())
    return "".join(parts)


def macro_param(macro, name):
    for param in macro.find_all("ac:parameter", recursive=False):
        if param.get("ac:name") == name:
            return param.get_text()
    return None


PANEL_LABELS = {"info": "Info", "note": "Note", "warning": "Warning", "tip": "Tip", "panel": "Panel"}

EMOJI_MAP = {
    "check_mark": "✅", "cross_mark": "❌", "tick": "✅", "cross": "❌",
    "warning": "⚠️", "information": "ℹ️", "question": "❓",
    "plus": "➕", "minus": "➖", "light_bulb_on": "💡", "star_yellow": "⭐",
    "thumbs_up": "👍", "thumbs_down": "👎", "smile": "🙂", "sad": "🙁",
    "laugh": "😄", "wink": "😉", "heart": "❤️", "airplane": "✈️",
}


class Converter:
    """Convert one page's storage-format XHTML to markdown."""

    def __init__(self, soup_factory=lambda html: BeautifulSoup(html, "html.parser"), user_resolver=None):
        self.soup_factory = soup_factory
        self.user_resolver = user_resolver or (lambda account_id: None)

    def convert(self, html, page_title):
        self.stash = {}
        soup = self.soup_factory(html)

        for macro in list(soup.find_all("ac:structured-macro")):
            self._replace_macro(soup, macro, page_title)
        for task_list in list(soup.find_all("ac:task-list")):
            self._replace_task_list(soup, task_list)
        for image in list(soup.find_all("ac:image")):
            self._replace_image(soup, image)
        for link in list(soup.find_all("ac:link")):
            self._replace_link(soup, link)
        for emoticon in list(soup.find_all("ac:emoticon")):
            fallback = (emoticon.get("ac:emoji-fallback") or "").strip()
            name = (emoticon.get("ac:name") or "").strip()
            shortname = (emoticon.get("ac:emoji-shortname") or "").strip(":")
            if fallback and not fallback.startswith(":"):
                replacement = fallback  # already a unicode emoji
            else:
                replacement = EMOJI_MAP.get(name) or EMOJI_MAP.get(shortname) or (f":{name}:" if name else "")
            emoticon.replace_with(replacement)
        for time_el in list(soup.find_all("time")):
            if not time_el.get_text(strip=True):
                time_el.replace_with(time_el.get("datetime") or "")
        for user in list(soup.find_all("ri:user")):
            name = self.user_resolver(user.get("ri:account-id") or "")
            user.replace_with(f"@{name}" if name else "@user")
        for tag_name in ("ac:layout", "ac:layout-section", "ac:layout-cell", "ac:link-body", "ac:adf-extension"):
            for el in list(soup.find_all(tag_name)):
                el.unwrap()

        text = markdownify(str(soup), heading_style="ATX", bullets="*")
        for token, replacement in self.stash.items():
            text = text.replace(token, replacement)
        text = re.sub(r"[ \t]+$", "", text, flags=re.MULTILINE)
        text = re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"
        return text

    def _stash(self, markdown_block):
        token = f"OKFSTASH{len(self.stash)}TOKEN"
        self.stash[token] = markdown_block
        return token

    def _replace_macro(self, soup, macro, page_title):
        name = macro.get("ac:name") or ""
        if name == "code":
            language = macro_param(macro, "language") or ""
            code = cdata_text(macro.find("ac:plain-text-body")).strip("\n")
            token = self._stash(f"```{language}\n{code}\n```")
            macro.replace_with(soup.new_string(f"\n\n{token}\n\n"))
        elif name in PANEL_LABELS:
            body = macro.find("ac:rich-text-body")
            wrapper = soup.new_tag("blockquote")
            strong = soup.new_tag("strong")
            strong.string = f"{PANEL_LABELS[name]}: "
            wrapper.append(strong)
            if body:
                for child in list(body.contents):
                    wrapper.append(child)
            macro.replace_with(wrapper)
        elif name == "expand":
            title = macro_param(macro, "title")
            body = macro.find("ac:rich-text-body")
            container = soup.new_tag("div")
            if title:
                para = soup.new_tag("p")
                strong = soup.new_tag("strong")
                strong.string = title
                para.append(strong)
                container.append(para)
            if body:
                for child in list(body.contents):
                    container.append(child)
            macro.replace_with(container)
        elif name == "status":
            title = macro_param(macro, "title") or "status"
            strong = soup.new_tag("strong")
            strong.string = f"[{title.upper()}]"
            macro.replace_with(strong)
        elif name in ("children", "pagetree"):
            # Resolved to a list of child page links in the main loop.
            macro.replace_with(soup.new_string("\n\nOKFCHILDRENTOKEN\n\n"))
        elif name in ("toc", "anchor"):
            macro.decompose()
        else:
            body = macro.find("ac:rich-text-body")
            if body:
                macro.replace_with(body)
                body.unwrap()
            else:
                warn(f"dropped unsupported macro '{name}' on page '{page_title}'")
                macro.decompose()

    def _replace_task_list(self, soup, task_list):
        lines = []
        for task in task_list.find_all("ac:task"):
            status = task.find("ac:task-status")
            done = status is not None and status.get_text().strip() == "complete"
            body = task.find("ac:task-body")
            text = body.get_text(" ", strip=True) if body else ""
            lines.append(f"- [{'x' if done else ' '}] {text}")
        token = self._stash("\n".join(lines))
        task_list.replace_with(soup.new_string(f"\n\n{token}\n\n"))

    def _replace_image(self, soup, image):
        attachment = image.find("ri:attachment")
        url = image.find("ri:url")
        alt = image.get("ac:alt") or image.get("ac:title") or ""
        img = soup.new_tag("img", alt=alt)
        if attachment is not None and attachment.get("ri:filename"):
            img["src"] = "okfasset://" + requests.utils.quote(attachment.get("ri:filename"), safe="")
        elif url is not None and url.get("ri:value"):
            img["src"] = url.get("ri:value")
        else:
            image.decompose()
            return
        image.replace_with(img)

    def _replace_link(self, soup, link):
        ri_page = link.find("ri:page")
        ri_attachment = link.find("ri:attachment")
        ri_user = link.find("ri:user")
        body = link.find("ac:plain-text-link-body") or link.find("ac:link-body")
        text = cdata_text(body).strip() if body else ""
        if ri_user is not None:
            name = self.user_resolver(ri_user.get("ri:account-id") or "")
            link.replace_with(text or (f"@{name}" if name else "@user"))
            return
        anchor = soup.new_tag("a")
        if ri_page is not None and ri_page.get("ri:content-title"):
            title = ri_page.get("ri:content-title")
            anchor["href"] = "okfpage://" + requests.utils.quote(title, safe="")
            anchor.string = text or title
        elif ri_attachment is not None and ri_attachment.get("ri:filename"):
            filename = ri_attachment.get("ri:filename")
            anchor["href"] = "okfasset://" + requests.utils.quote(filename, safe="")
            anchor.string = text or filename
        else:
            link.replace_with(text)
            return
        link.replace_with(anchor)


def first_paragraph(markdown_text, limit=140):
    for line in markdown_text.splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "|", "```", "![", "---")):
            continue
        line = re.sub(r"[*_`<>\[\]]", "", line)
        line = re.sub(r"\(([^)]*)\)", "", line).strip()
        if len(line) < 10:
            continue
        return (line[: limit - 1] + "…") if len(line) > limit else line
    return None


def assign_paths(pages_by_id, children, roots):
    """Assign bundle paths: page -> <dir>/<slug>.md, children -> <dir>/<slug>/.

    Container nodes (Confluence folders/databases/whiteboards) become plain
    directories without a concept file of their own.
    """

    def recurse(page_id, dir_prefix):
        page = pages_by_id[page_id]
        slug = slugify(page["title"])
        sibling_slugs = taken.setdefault(dir_prefix, set())
        base = slug
        counter = 2
        while slug in sibling_slugs:
            slug = f"{base}-{counter}"
            counter += 1
        sibling_slugs.add(slug)
        page["okf_dir"] = dir_prefix.rstrip("/")
        page["okf_child_dir"] = f"{dir_prefix}{slug}/"
        if not page.get("is_container"):
            page["okf_path"] = f"{dir_prefix}{slug}.md"
        for child_id in sorted(children.get(page_id, []), key=lambda c: pages_by_id[c]["title"].lower()):
            recurse(child_id, f"{dir_prefix}{slug}/")

    taken = {}
    for root_id in roots:
        recurse(root_id, "")


CONTAINER_KINDS = ("folders", "databases", "whiteboards", "embeds")


def fetch_container(api, content_id):
    """Resolve a non-page parent (folder, database, ...) to a title and parent."""
    for kind in CONTAINER_KINDS:
        try:
            data = api.get(f"/wiki/api/v2/{kind}/{content_id}")
            return {
                "id": str(data["id"]),
                "title": data.get("title") or f"container-{content_id}",
                "parentId": str(data.get("parentId") or ""),
                "is_container": True,
                "kind": kind.rstrip("s"),
            }
        except Exception:  # noqa: BLE001
            continue
    return None


def acli_credentials(site_host):
    """Reuse credentials stored by the Atlassian CLI (acli).

    acli keeps profile metadata in ~/.config/acli/<product>_config.yaml and the
    API token in the OS keyring under service "acli", account
    "<product>:<cloud_id>:<account_id>". Values may be wrapped in the
    go-keyring base64 envelope. macOS only (uses the `security` tool).
    Returns (email, token) or (None, None).
    """
    config_dir = Path.home() / ".config" / "acli"
    for product in ("confluence", "jira"):
        config = config_dir / f"{product}_config.yaml"
        if not config.exists():
            continue
        for block in config.read_text().split("- site:")[1:]:
            site = block.strip().split("\n")[0].strip()
            cloud = re.search(r"cloud_id:\s*(\S+)", block)
            account = re.search(r"account_id:\s*(\S+)", block)
            email = re.search(r"email:\s*(\S+)", block)
            auth_type = re.search(r"auth_type:\s*(\S+)", block)
            if not (cloud and account and email):
                continue
            if site_host and site != site_host:
                continue
            # OAuth profiles store an encrypted blob, not a reusable API token.
            if auth_type and auth_type.group(1) != "api_token":
                continue
            keyring_account = f"{product}:{cloud.group(1)}:{account.group(1)}"
            result = subprocess.run(
                ["security", "find-generic-password", "-s", "acli", "-a", keyring_account, "-w"],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                continue
            secret = result.stdout.strip()
            if secret.startswith("go-keyring-base64:"):
                try:
                    secret = base64.b64decode(secret[len("go-keyring-base64:"):]).decode()
                except UnicodeDecodeError:
                    continue
            print(f"Using acli credentials ({product} profile, {email.group(1)})")
            return email.group(1), secret
    return None, None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", required=True, help="https://<org>.atlassian.net")
    parser.add_argument("--space", required=True, help="Space key, e.g. ED")
    parser.add_argument("--out", required=True, help="Output directory (bundle root)")
    parser.add_argument("--email", default=os.environ.get("CONFLUENCE_EMAIL"))
    parser.add_argument("--token-file", default=None, help="File containing the API token")
    parser.add_argument("--type", default="Wiki Page", help="OKF concept type for migrated pages")
    args = parser.parse_args()

    token = os.environ.get("CONFLUENCE_API_TOKEN", "")
    if args.token_file:
        token = Path(args.token_file).expanduser().read_text().strip()
    if not token:
        site_host = re.sub(r"^https?://", "", args.site).split("/")[0]
        acli_email, acli_token = acli_credentials(site_host)
        if acli_token:
            token = acli_token
            args.email = args.email or acli_email
    if not args.email or not token:
        sys.exit(
            "Missing credentials: set CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN (or --email/--token-file), "
            "or authenticate the Atlassian CLI: acli confluence auth login"
        )

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    api = Confluence(args.site, args.email, token)

    spaces = api.get("/wiki/api/v2/spaces", keys=args.space).get("results", [])
    if not spaces:
        sys.exit(f"Space '{args.space}' not found or not accessible.")
    space = spaces[0]
    homepage_id = str(space.get("homepageId") or "")
    print(f"Space: {space.get('name')} (id {space['id']}, homepage {homepage_id})")

    pages_by_id = {}
    for page in api.paged(f"/wiki/api/v2/spaces/{space['id']}/pages", **{"limit": 100, "body-format": "storage"}):
        page["id"] = str(page["id"])
        pages_by_id[page["id"]] = page
    print(f"Fetched {len(pages_by_id)} pages")

    # Resolve non-page parents (Confluence folders, databases, ...) into
    # container nodes so their children keep their hierarchy.
    pending = {
        str(p.get("parentId") or "")
        for p in pages_by_id.values()
        if p.get("parentId") and str(p["parentId"]) not in pages_by_id and str(p["parentId"]) != homepage_id
    } - {""}
    while pending:
        container_id = pending.pop()
        container = fetch_container(api, container_id)
        if not container:
            warn(f"parent {container_id} could not be resolved; its children move to the bundle root")
            continue
        warn(
            f"'{container['title']}' is a Confluence {container['kind']}; it becomes a directory, "
            "its own content is not migrated"
        )
        pages_by_id[container["id"]] = container
        parent_id = container["parentId"]
        if parent_id and parent_id not in pages_by_id and parent_id != homepage_id:
            pending.add(parent_id)

    children = {}
    roots = []
    for page in pages_by_id.values():
        parent_id = str(page.get("parentId") or "")
        if page["id"] == homepage_id:
            continue  # flattened below
        if parent_id and parent_id in pages_by_id and parent_id != homepage_id:
            children.setdefault(parent_id, []).append(page["id"])
        else:
            roots.append(page["id"])
    roots.sort(key=lambda pid: pages_by_id[pid]["title"].lower())

    assign_paths(pages_by_id, children, roots)
    if homepage_id in pages_by_id:
        homepage = pages_by_id[homepage_id]
        homepage["okf_path"] = "overview.md"
        homepage["okf_dir"] = ""

    title_to_path = {}
    for page in pages_by_id.values():
        if "okf_path" not in page:
            continue
        if page["title"] in title_to_path:
            warn(f"duplicate page title '{page['title']}': links resolve to the first occurrence")
        else:
            title_to_path[page["title"]] = page["okf_path"]

    user_cache = {}

    def resolve_user(account_id):
        if not account_id:
            return None
        if account_id not in user_cache:
            try:
                user = api.get("/wiki/rest/api/user", accountId=account_id)
                user_cache[account_id] = user.get("displayName")
            except Exception:  # noqa: BLE001
                user_cache[account_id] = None
        return user_cache[account_id]

    converter = Converter(user_resolver=resolve_user)
    attachment_index = {}  # page id -> {filename: bundle asset path}
    claimed_assets = set()  # asset paths written during this run, for collision detection
    stats = {"pages": 0, "attachments": 0}

    for page in pages_by_id.values():
        if "okf_path" not in page:
            continue
        page_dir = page["okf_dir"]
        assets_dir = f"{page_dir}/assets" if page_dir else "assets"
        index = {}
        try:
            for att in api.paged(f"/wiki/api/v2/pages/{page['id']}/attachments", limit=50):
                filename = att.get("title") or f"attachment-{att['id']}"
                safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", filename)
                asset_path = f"{assets_dir}/{safe}"
                if asset_path in claimed_assets:
                    # Another page in this directory already owns this filename.
                    slug = Path(page["okf_path"]).stem
                    asset_path = f"{assets_dir}/{slug}-{safe}"
                claimed_assets.add(asset_path)
                target = out / asset_path
                link = att.get("downloadLink") or (att.get("_links", {}) or {}).get("download")
                if not link:
                    warn(f"attachment '{filename}' on '{page['title']}' has no download link")
                    continue
                try:
                    api.download(link, target)
                    index[filename] = asset_path
                    stats["attachments"] += 1
                except Exception as exc:  # noqa: BLE001
                    warn(f"failed to download '{filename}' from '{page['title']}': {exc}")
        except Exception as exc:  # noqa: BLE001
            warn(f"could not list attachments of '{page['title']}': {exc}")
        attachment_index[page["id"]] = index

    for page in sorted(pages_by_id.values(), key=lambda p: p.get("okf_path", "")):
        if "okf_path" not in page:
            continue
        html = ((page.get("body") or {}).get("storage") or {}).get("value") or ""
        text = converter.convert(html, page["title"])

        def resolve_page(match):
            title = requests.utils.unquote(match.group(1))
            target = title_to_path.get(title)
            if target:
                return "/" + target
            warn(f"unresolved link to '{title}' on page '{page['title']}'")
            return f"{args.site}/wiki/spaces/{args.space}/pages?title=" + requests.utils.quote(title)

        def resolve_asset(match):
            filename = requests.utils.unquote(match.group(1))
            asset = attachment_index.get(page["id"], {}).get(filename)
            if asset:
                return "/" + asset
            warn(f"missing attachment '{filename}' referenced on '{page['title']}'")
            return filename

        text = re.sub(r"okfpage://([^)\s\"]+)", resolve_page, text)
        text = re.sub(r"okfasset://([^)\s\"]+)", resolve_asset, text)

        if "OKFCHILDRENTOKEN" in text:
            if page["id"] == homepage_id:
                child_ids = roots
            else:
                child_ids = sorted(
                    children.get(page["id"], []), key=lambda c: pages_by_id[c]["title"].lower()
                )
            listing = "\n".join(
                f"* [{pages_by_id[c]['title']}]({pages_by_id[c]['okf_child_dir']})"
                if pages_by_id[c].get("is_container")
                else f"* [{pages_by_id[c]['title']}](/{pages_by_id[c]['okf_path']})"
                for c in child_ids
            )
            text = re.sub(r"(OKFCHILDRENTOKEN\n*)+", (listing or "*(no subpages)*") + "\n", text)
            text = re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"

        try:
            labels = [l.get("name") for l in api.paged(f"/wiki/api/v2/pages/{page['id']}/labels", limit=50)]
        except Exception:  # noqa: BLE001
            labels = []

        description = first_paragraph(text)
        page["okf_description"] = description
        version_date = ((page.get("version") or {}).get("createdAt")) or ""

        lines = ["---", f"type: {yaml_str(args.type)}", f"title: {yaml_str(page['title'])}"]
        if description:
            lines.append(f"description: {yaml_str(description)}")
        if labels:
            lines.append("tags: [" + ", ".join(yaml_str(l) for l in labels if l) + "]")
        if version_date:
            lines.append(f"timestamp: {yaml_str(version_date)}")
        lines.append(f"confluence_id: {yaml_str(page['id'])}")
        lines.append("---")
        content = "\n".join(lines) + "\n\n" + text

        target = out / page["okf_path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        stats["pages"] += 1
        print(f"  wrote {page['okf_path']}")

    # Root index.md: progressive-disclosure listing of top-level entries.
    index_lines = ["---", 'okf_version: "0.1"', "---", "", f"# {space.get('name') or args.space}", ""]
    if homepage_id in pages_by_id:
        home = pages_by_id[homepage_id]
        desc = home.get("okf_description") or "Space overview"
        index_lines.append(f"* [{home['title']}](/overview.md) - {desc}")
    for root_id in roots:
        page = pages_by_id[root_id]
        desc = page.get("okf_description") or ""
        if page.get("is_container"):
            index_lines.append(f"* [{page['title']}]({page['okf_child_dir']}) - {len(children.get(root_id, []))} pages")
            continue
        entry = f"* [{page['title']}](/{page['okf_path']})"
        index_lines.append(entry + (f" - {desc}" if desc else ""))
        if children.get(root_id):
            index_lines.append(
                f"* [{page['title']} subpages]({page['okf_child_dir']}) - {len(children[root_id])} subpages"
            )
    (out / "index.md").write_text("\n".join(index_lines) + "\n", encoding="utf-8")

    from datetime import date

    log_path = out / "log.md"
    log_entry = (
        f"# Update Log\n\n## {date.today().isoformat()}\n"
        f"* **Initialization**: Migrated {stats['pages']} pages and {stats['attachments']} attachments "
        f"from Confluence space [{args.space}]({args.site}/wiki/spaces/{args.space}/).\n"
    )
    log_path.write_text(log_entry, encoding="utf-8")

    print(json.dumps({"summary": stats, "warnings": len(WARNINGS)}))
    if WARNINGS:
        print(f"{len(WARNINGS)} warnings (see stderr above)", file=sys.stderr)


if __name__ == "__main__":
    main()
