'use client'

import { useEffect } from 'react'

import { trackSearchExecuted, trackSearchNoResults } from '@/lib/analytics'

/**
 * How long a query must stay put before it counts as a search.
 *
 * The directory search box rewrites the URL as you type, so the server re-renders
 * this tracker once per prefix. Without a settle window, typing 香氛 would report
 * two searches — and one of them a zero-result one for 香.
 */
export const SEARCH_SETTLE_MS = 800

/**
 * Module-scoped rather than a ref: client-side navigation between directory URLs
 * can remount the tracker, and a remount is not a new search.
 */
let lastEmittedQuery: string | null = null

/** @internal test seam — the guard above is deliberately not reset by React. */
export function __resetSearchTrackerForTests() {
  lastEmittedQuery = null
}

interface SearchResultsTrackerProps {
  /** The search the results below actually answer. Empty means the visitor is browsing. */
  query: string
  /** Total matches from `search_brand_page`, not the page slice and not the typeahead. */
  resultCount: number
}

/**
 * Emits the search events from the results page, where the true result count is known.
 *
 * This lives here rather than in `search-input.tsx` because the input only ever knows
 * the typeahead's suggestion list — a different query, capped at 5, and often still
 * empty at submit time (DEV-1412).
 */
export function SearchResultsTracker({ query, resultCount }: SearchResultsTrackerProps) {
  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) return

    const timer = setTimeout(() => {
      if (lastEmittedQuery === trimmed) return
      lastEmittedQuery = trimmed
      trackSearchExecuted(trimmed, resultCount)
      if (resultCount === 0) {
        trackSearchNoResults(trimmed)
      }
    }, SEARCH_SETTLE_MS)

    return () => clearTimeout(timer)
  }, [query, resultCount])

  return null
}
