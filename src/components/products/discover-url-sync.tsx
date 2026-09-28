'use client'

import { useEffect } from 'react'

import { skipNextPageview } from '@/lib/analytics/pageview-skip'

interface DiscoverUrlSyncProps {
  /** Target query string: "" or "?…". */
  search: string
}

// Writes the server-resolved (including LLM-inferred) filters into the address bar
// without a navigation. window.location.pathname is used instead of usePathname so
// the locale prefix (/en/…) survives. The GA page_view for this rewrite is skipped:
// the search submit already logged one.
export function DiscoverUrlSync({ search }: DiscoverUrlSyncProps) {
  useEffect(() => {
    if (window.location.search === search) return
    skipNextPageview()
    window.history.replaceState(
      {},
      '',
      window.location.pathname + search + window.location.hash,
    )
  }, [search])

  return null
}
