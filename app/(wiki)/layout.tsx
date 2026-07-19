import Shell from '@/components/Shell'

/**
 * Persistent shell for all wiki routes: mounts once, so the navigation tree
 * survives client-side navigation instead of reloading per page.
 */
export default function WikiLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>
}
