'use client'

import { useState } from 'react'

export interface EnvVar {
  key: string
  value: string
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="btn"
      style={{ position: 'absolute', top: 8, right: 8 }}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=-]*$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * The wizard's final output: the deployment's environment, as a plain env
 * block and as a ready-to-run docker command.
 */
export default function EnvBlock({ vars }: { vars: EnvVar[] }) {
  const envText = vars.map((v) => `${v.key}=${v.value}`).join('\n')
  const dockerText =
    'docker run -p 3000:3000 \\\n' +
    vars.map((v) => `  -e ${v.key}=${shellQuote(v.value)} \\`).join('\n') +
    '\n  commonplacewiki/commonplace'
  return (
    <div>
      <p style={{ marginBottom: 4 }}>Environment variables:</p>
      <div style={{ position: 'relative' }}>
        <pre>{envText}</pre>
        <CopyButton text={envText} />
      </div>
      <p style={{ marginBottom: 4 }}>Or as a docker command:</p>
      <div style={{ position: 'relative' }}>
        <pre>{dockerText}</pre>
        <CopyButton text={dockerText} />
      </div>
    </div>
  )
}
