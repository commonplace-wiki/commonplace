import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Commonplace',
  description: 'A GitHub-backed wiki for Open Knowledge Format bundles',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
