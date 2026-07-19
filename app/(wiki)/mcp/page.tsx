'use client'

import { useEffect, useState } from 'react'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // Clipboard may be unavailable (insecure context); ignore.
        }
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="code-block">
      <div className="markdown">
        <pre>
          <code>{children}</code>
        </pre>
      </div>
      <CopyButton text={children} />
    </div>
  )
}

export default function McpPage() {
  const [origin, setOrigin] = useState('')
  useEffect(() => setOrigin(window.location.origin), [])

  const endpoint = `${origin || 'https://your-wiki-host'}/api/mcp`

  const claudeCodeCommand = `claude mcp add --transport http commonplace ${endpoint} --header "Authorization: Bearer YOUR_GITHUB_TOKEN"`

  const desktopConfig = `{
  "mcpServers": {
    "commonplace": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "${endpoint}",
        "--header",
        "Authorization: Bearer YOUR_GITHUB_TOKEN"
      ]
    }
  }
}`

  return (
    <div className="mcp-page">
      <h1 className="page-title">MCP server</h1>
      <p className="muted">
        This wiki runs a Model Context Protocol (MCP) server, so AI assistants like Claude can
        search, read, and write pages directly. Point your MCP client at the endpoint below and
        authenticate with a GitHub token that can access the wiki repository.
      </p>

      <div className="card">
        <h2>Endpoint</h2>
        <CodeBlock>{endpoint}</CodeBlock>
        <p className="muted">
          Streamable HTTP transport. Authenticate with the header{' '}
          <code>Authorization: Bearer &lt;github-token&gt;</code>.
        </p>
      </div>

      <div className="card">
        <h2>Authentication</h2>
        <p className="muted">
          Use a GitHub personal access token that has access to the wiki repository (the same kind
          of token you can sign in with). Create one at{' '}
          <a href="https://github.com/settings/tokens" target="_blank" rel="noreferrer">
            github.com/settings/tokens
          </a>
          . A read-only token is enough to search and read pages; saving pages needs write access.
        </p>
      </div>

      <div className="card">
        <h2>Add to Claude Code</h2>
        <p className="muted">Run this in your terminal, with your token in place of the placeholder:</p>
        <CodeBlock>{claudeCodeCommand}</CodeBlock>
      </div>

      <div className="card">
        <h2>Add to Claude Desktop</h2>
        <p className="muted">
          Add this to <code>claude_desktop_config.json</code> (Settings → Developer → Edit config),
          then restart Claude Desktop. It uses <code>mcp-remote</code> to attach the token to the
          connection.
        </p>
        <CodeBlock>{desktopConfig}</CodeBlock>
      </div>

      <div className="card">
        <h2>Available tools</h2>
        <ul className="mcp-tools">
          <li>
            <code>search_pages</code> — search pages by content, title, path, tag, or OKF concept
            type.
          </li>
          <li>
            <code>get_page</code> — fetch one page: OKF frontmatter, markdown body, and its blob
            sha.
          </li>
          <li>
            <code>save_page</code> — create or update a page (requires write access).
          </li>
        </ul>
      </div>
    </div>
  )
}
