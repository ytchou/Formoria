'use client'

import { useEffect } from 'react'

import { skipPageviewFor, toAnalyticsPagePath } from '@/lib/analytics/pageview-skip'

interface DiscoverUrlSyncProps {
  /** Target query string: "" or "?…". */
  search: string
}

// Writes the server-resolved (including LLM-inferred) filters into the address bar
// without a navigation. window.location.pathname is used instead of usePathname so
// the locale prefix (/en/…) survives. The URL is always made canonical, but a GA
// page_view skip is registered only when the rewrite changes the scrubbed page path
// GA reports: the search submit or navigation already logged its page_view.
export function DiscoverUrlSync({ search }: DiscoverUrlSyncProps) {
  useEffect(() => {
    const { pathname, hash } = window.location
    const current = window.location.search
    if (current === search) return

    const from = toAnalyticsPagePath(pathname, current)
    const to = toAnalyticsPagePath(pathname, search)
    if (from !== to) skipPageviewFor(from, to)

    window.history.replaceState({}, '', pathname + search + hash)
  }, [search])

  return null
}
