'use client'

import Link from 'next/link'
import ReactMarkdown from 'react-markdown'
import remarkDirective from 'remark-directive'
import remarkGfm from 'remark-gfm'
import { visit } from 'unist-util-visit'

const ADMONITION_TYPES = ['note', 'info', 'tip', 'caution', 'danger']

/**
 * Render :::note / :::info / … container directives as styled panels, and
 * neutralize every other directive node remark-directive produces. Without
 * this, prose like "ubuntu:latest" parses as an inline text directive and
 * falls back to a <div>, which inside a <p> breaks React hydration.
 */
function remarkAdmonitions() {
  return (tree: unknown) => {
    visit(
      tree as never,
      (node: any, index: number | undefined, parent: any): number | undefined => {
        if (node.type === 'containerDirective' || node.type === 'leafDirective') {
          const admonition = node.type === 'containerDirective' && ADMONITION_TYPES.includes(node.name)
          node.data = {
            ...node.data,
            hName: 'div',
            ...(admonition
              ? { hProperties: { className: ['admonition', `admonition-${node.name}`] } }
              : {}),
          }
          return undefined
        }
        if (node.type === 'textDirective' && parent && typeof index === 'number') {
          // Restore the original ":name" text (plus any [label] content).
          parent.children.splice(index, 1, { type: 'text', value: `:${node.name}` }, ...(node.children || []))
          return index + 1
        }
        return undefined
      }
    )
  }
}

/**
 * Resolve an OKF link target to a bundle-relative path.
 * Absolute links (starting with /) are bundle-root-relative per the spec;
 * other links are relative to the current document's directory.
 */
function resolveTarget(href: string, baseDir: string): string {
  let segments: string[]
  if (href.startsWith('/')) {
    segments = href.replace(/^\/+/, '').split('/')
  } else {
    segments = baseDir ? baseDir.split('/') : []
    for (const part of href.split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') segments.pop()
      else segments.push(part)
    }
    return segments.join('/')
  }
  const out: string[] = []
  for (const part of segments) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}

export default function Markdown({ content, baseDir }: { content: string; baseDir: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkAdmonitions]}
        components={{
          a({ href, children, ...props }) {
            if (!href || href.startsWith('#')) {
              return <a href={href} {...props}>{children}</a>
            }
            const scheme = href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase()
            if (scheme) {
              // Only follow safe external schemes. javascript:, data:, vbscript:
              // and the like would execute in the wiki's origin on click, so
              // render them as inert text instead of a live link.
              if (!['http', 'https', 'mailto'].includes(scheme)) {
                return <span {...props}>{children}</span>
              }
              return (
                <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
                  {children}
                </a>
              )
            }
            const [pathPart, hash] = href.split('#')
            const target = resolveTarget(pathPart, baseDir)
            if (target.endsWith('.md') || pathPart.endsWith('/') || !target.includes('.')) {
              // Wiki page or directory link.
              const url = `/${target}${hash ? `#${hash}` : ''}`
              return (
                <Link href={url} {...props}>
                  {children}
                </Link>
              )
            }
            // Other repository asset: serve raw through the API.
            return (
              <a href={`/api/raw?path=${encodeURIComponent(target)}`} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            )
          },
          img({ src, alt, ...props }) {
            const srcStr = typeof src === 'string' ? src : ''
            const srcScheme = srcStr.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase()
            if (srcScheme) {
              // Absolute image source: allow only inert schemes.
              if (!['http', 'https', 'data'].includes(srcScheme)) {
                return null
              }
              // eslint-disable-next-line @next/next/no-img-element
              return <img src={srcStr} alt={alt || ''} {...props} />
            }
            const target = resolveTarget(srcStr, baseDir)
            // eslint-disable-next-line @next/next/no-img-element
            return <img src={`/api/raw?path=${encodeURIComponent(target)}`} alt={alt || ''} {...props} />
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
