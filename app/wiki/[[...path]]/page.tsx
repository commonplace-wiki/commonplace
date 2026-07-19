'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect } from 'react'

/** Legacy /wiki/* URLs redirect to the root-level page paths. */
export default function LegacyWikiRedirect() {
  const params = useParams<{ path?: string[] }>()
  const router = useRouter()
  useEffect(() => {
    router.replace('/' + (params.path || []).join('/'))
  }, [params, router])
  return null
}
