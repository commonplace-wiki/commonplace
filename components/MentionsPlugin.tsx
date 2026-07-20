'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addComposerChild$, realmPlugin, rootEditor$, useCellValues } from '@mdxeditor/editor'
import { $createLinkNode, $isLinkNode } from '@lexical/link'
import {
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_DOWN_COMMAND,
} from 'lexical'
import type { MentionUser } from '@/lib/repo'

/**
 * The @-mention token being typed: the '@' must start the text node or follow
 * whitespace or an opening bracket, which is what keeps email addresses from
 * triggering the popup. The name charset covers GitHub logins and GitLab
 * usernames (which also allow '.' and '_').
 */
const TRIGGER = /(^|[\s([{])@([a-zA-Z0-9][a-zA-Z0-9._-]{0,38})?$/

const MAX_RESULTS = 8

let usersPromise: Promise<MentionUser[]> | null = null

/** Collaborators, fetched once per page load and shared by every popup open. */
function fetchMentionUsers(): Promise<MentionUser[]> {
  if (!usersPromise) {
    usersPromise = fetch('/api/mentions')
      .then((res) => (res.ok ? res.json() : { users: [] }))
      .then((data) => (Array.isArray(data?.users) ? (data.users as MentionUser[]) : []))
      .catch(() => {
        // Let a later '@' retry rather than caching a network failure forever.
        usersPromise = null
        return []
      })
  }
  return usersPromise
}

function rankUsers(users: MentionUser[], query: string): MentionUser[] {
  if (!query) return users.slice(0, MAX_RESULTS)
  const q = query.toLowerCase()
  const matches = users.filter(
    (u) => u.login.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q)
  )
  matches.sort((a, b) => {
    const aPrefix = a.login.toLowerCase().startsWith(q) ? 0 : 1
    const bPrefix = b.login.toLowerCase().startsWith(q) ? 0 : 1
    return aPrefix - bPrefix || a.login.localeCompare(b.login)
  })
  return matches.slice(0, MAX_RESULTS)
}

/** Rect of the caret, measured from the '@' so a collapsed caret still has geometry. */
function caretRect(): DOMRect | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0).cloneRange()
  if (range.startOffset > 0) {
    try {
      range.setStart(range.startContainer, range.startOffset - 1)
    } catch {
      // Non-text container: fall through to the collapsed rect.
    }
  }
  const rect = range.getBoundingClientRect()
  return rect.width || rect.height ? rect : null
}

interface TriggerState {
  query: string
  nodeKey: string
  matchStart: number
  rect: DOMRect
}

function MentionsPopup() {
  const [editor] = useCellValues(rootEditor$)
  const [trigger, setTrigger] = useState<TriggerState | null>(null)
  const [users, setUsers] = useState<MentionUser[]>([])
  const [active, setActive] = useState(0)
  // Token the user dismissed with Escape, as `${nodeKey}:${matchStart}`. Keeps
  // the popup shut for that '@word' while still reopening for a fresh one.
  const dismissed = useRef<string | null>(null)
  // Last `${nodeKey}:${matchStart}:${query}` the popup opened for, so the
  // highlight only resets when the query actually changes.
  const lastToken = useRef<string | null>(null)

  const results = trigger ? rankUsers(users, trigger.query) : []

  useEffect(() => {
    if (!editor) return
    return editor.registerUpdateListener(() => {
      if (editor.isComposing()) return
      let next: Omit<TriggerState, 'rect'> | null = null
      editor.getEditorState().read(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return
        const node = selection.anchor.getNode()
        if (!$isTextNode(node)) return
        // Not inside an existing link (so mentions don't re-trigger) and not
        // inside inline code.
        if ($isLinkNode(node.getParent()) || node.hasFormat('code')) return
        const before = node.getTextContent().slice(0, selection.anchor.offset)
        const match = TRIGGER.exec(before)
        if (!match) return
        next = {
          query: match[2] ?? '',
          nodeKey: node.getKey(),
          matchStart: match.index + match[1].length,
        }
      })
      if (!next) {
        dismissed.current = null
        setTrigger(null)
        return
      }
      const { nodeKey, matchStart } = next
      if (dismissed.current === `${nodeKey}:${matchStart}`) return
      const rect = caretRect()
      if (!rect) return
      const opened = next as Omit<TriggerState, 'rect'>
      const token = `${opened.nodeKey}:${opened.matchStart}:${opened.query}`
      setTrigger({ ...opened, rect })
      // Reset the highlight whenever the query changes, but leave it alone
      // while the user is arrowing through an unchanged result list.
      if (lastToken.current !== token) setActive(0)
      lastToken.current = token
    })
  }, [editor])

  // Load the collaborator list on first open, not on editor mount: readers who
  // never type '@' should not pay for the request.
  useEffect(() => {
    if (!trigger) return
    let cancelled = false
    fetchMentionUsers().then((list) => {
      if (!cancelled) setUsers(list)
    })
    return () => {
      cancelled = true
    }
  }, [trigger])

  const insertMention = useCallback(
    (user: MentionUser) => {
      if (!editor) return
      editor.update(() => {
        // Re-derive the match from the live selection: the state captured by
        // the update listener may be a commit stale.
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return
        const node = $getNodeByKey(selection.anchor.getNode().getKey())
        if (!$isTextNode(node)) return
        const offset = selection.anchor.offset
        const match = TRIGGER.exec(node.getTextContent().slice(0, offset))
        if (!match) return
        const start = match.index + match[1].length

        // Isolate the '@query' run, then swap it for the link.
        const parts = start > 0 ? node.splitText(start, offset) : node.splitText(offset)
        const mentionText = start > 0 ? parts[1] : parts[0]
        if (!mentionText) return
        const link = $createLinkNode(user.profileUrl)
        link.append($createTextNode(`@${user.login}`))
        mentionText.replace(link)

        // Trailing space with the caret after it, so typing continues outside
        // the link rather than extending it.
        const space = $createTextNode(' ')
        link.insertAfter(space)
        space.select(1, 1)
      })
      dismissed.current = null
      setTrigger(null)
    },
    [editor]
  )

  // Keyboard navigation, registered only while the popup is open so the
  // editor's own Enter/arrow handling is untouched the rest of the time.
  useEffect(() => {
    if (!editor || !trigger) return
    return editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        if (event.isComposing) return false
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setActive((a) => Math.min(a + 1, results.length - 1))
          return true
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setActive((a) => Math.max(a - 1, 0))
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          // With no matches, let Enter insert a newline as usual and leave the
          // typed text alone.
          const choice = results[active]
          if (!choice) return false
          event.preventDefault()
          insertMention(choice)
          return true
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          dismissed.current = `${trigger.nodeKey}:${trigger.matchStart}`
          setTrigger(null)
          return true
        }
        return false
      },
      COMMAND_PRIORITY_HIGH
    )
  }, [editor, trigger, results, active, insertMention])

  // The popup is anchored to a caret rect, so scrolling would strand it.
  useEffect(() => {
    if (!trigger) return
    const close = () => setTrigger(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [trigger])

  if (!trigger || typeof document === 'undefined') return null

  const style: React.CSSProperties = {
    position: 'fixed',
    top: trigger.rect.top + trigger.rect.height + 6,
    left: Math.max(8, Math.min(trigger.rect.left, window.innerWidth - 300)),
  }

  return createPortal(
    <div className="link-dialog mention-popup" style={style}>
      <div className="location-list">
        {results.map((user, i) => (
          <button
            key={user.login}
            className={`user-menu-item link-result mention-result${i === active ? ' active-dir' : ''}`}
            onMouseDown={(e) => {
              // Keep the editor selection alive through the click.
              e.preventDefault()
              insertMention(user)
            }}
            onMouseEnter={() => setActive(i)}
          >
            {user.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="mention-avatar" src={user.avatarUrl} alt="" />
            )}
            <span className="mention-login">@{user.login}</span>
            {user.name && <span className="mention-name">{user.name}</span>}
          </button>
        ))}
        {results.length === 0 && <span className="tree-empty">No matching users.</span>}
      </div>
    </div>,
    document.body
  )
}

/** Typing '@' opens a typeahead of repository collaborators; picking one
 * inserts a plain markdown link to their profile. */
export const mentionsPlugin = realmPlugin({
  init(realm) {
    realm.pub(addComposerChild$, MentionsPopup)
  },
})
