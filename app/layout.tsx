import type { Metadata } from 'next'
import './globals.css'

// A function, not a static export: the verification token is read when the
// deployment serves the page, not baked in when the Docker image is built.
export function generateMetadata(): Metadata {
  const google = process.env.GOOGLE_SITE_VERIFICATION?.trim()
  return {
    title: 'Commonplace',
    description: 'A GitHub-backed wiki for Open Knowledge Format bundles',
    ...(google ? { verification: { google } } : {}),
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
