'use client'

import dynamic from 'next/dynamic'
import type { MarkdownEditorProps } from './InitializedMDXEditor'

// MDXEditor manipulates the DOM directly and must never render on the server.
const Editor = dynamic(() => import('./InitializedMDXEditor'), {
  ssr: false,
  loading: () => <div className="md-editor md-editor-loading">Loading editor…</div>,
})

export default function MarkdownEditor(props: MarkdownEditorProps) {
  return <Editor {...props} />
}
