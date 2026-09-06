'use client'

import { useEffect, useRef } from 'react'

import { trackSearchExecuted, trackSearchNoResults, trackProductSearchExecuted } from '@/lib/analytics'

/**
 * How long a query must stay put before it counts as a search.
 *
 * The directory search box rewrites the URL as you type, so the server re-renders
 * this tracker once per prefix. Without a settle window, typing a two-ideograph
 * Chinese query would report two searches — and one of them a zero-result one for
 * the lone first character.
 */
export const SEARCH_SETTLE_MS = 800

/**
 * Mirrors the minimum enforced by `normalizePublicSearchQuery` in
 * `src/lib/services/brands.ts`, which is the authority: below it the service
 * short-circuits to zero results without ever calling the search RPC. Emitting
 * for a shorter query would report a zero-result search that never ran — and the
 * first keystroke of every Chinese search is a single ideograph.
 */
const MIN_SEARCH_QUERY_LENGTH = 2

/**
 * Module-scoped rather than a ref: client-side navigation between directory URLs
 * can remount the tracker, and a remount is not a new search.
 *
 * Keyed on the query *and* the count it produced: the same query answered by a
 * different result set (a filter ticked on) is a different search, and the
 * zero-result one is the catalog-gap signal we most need.
 */
let lastEmittedKey: string | null = null

/** @internal test seam — the guard above is deliberately not reset by React. */
export function __resetSearchTrackerForTests() {
  lastEmittedKey = null
}

interface SearchResultsTrackerProps {
  /** The search the results below actually answer. Empty means the visitor is browsing. */
  query: string
  /** Total matches from `search_brand_page`, not the page slice and not the typeahead. */
  resultCount: number
  /** Which tracker to use. Defaults to `"brand"` for the existing `/brands?search=` surface. */
  trackerKind?: 'brand' | 'product'
  /** Where the search originated. Only used when `trackerKind` is `"product"`. */
  searchSource?: string
  /** Whether the search fell back to lexical-only mode. Only used when `trackerKind` is `"product"`. */
  degraded?: boolean
}

/**
 * Emits the search events from the results page, where the true result count is known.
 *
 * This lives here rather than in `search-input.tsx` because the input only ever knows
 * the typeahead's suggestion list — a different query, capped at 5, and often still
 * empty at submit time (DEV-1412).
 */
/**
 * React StrictMode unmounts and remounts every effect once in development. That
 * simulated unmount lands in the same tick as the mount, so a pending emission
 * younger than this floor is StrictMode, not a visitor leaving the page.
 */
const FLUSH_MIN_AGE_MS = 50

export function SearchResultsTracker({ query, resultCount, trackerKind = 'brand', searchSource, degraded }: SearchResultsTrackerProps) {
  const pendingRef = useRef<(() => void) | null>(null)
  const pendingSinceRef = useRef(0)

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) {
      pendingRef.current = null
      return
    }

    const key = `${resultCount}:${trimmed}`
    const emit = () => {
      if (lastEmittedKey === key) return
      lastEmittedKey = key
      if (trackerKind === 'product') {
        trackProductSearchExecuted(trimmed, resultCount, {
          searchSource: searchSource ?? 'discover_page',
          degraded: degraded ?? false,
        })
      } else {
        trackSearchExecuted(trimmed, resultCount)
      }
      if (resultCount === 0 && trackerKind !== 'product') {
        trackSearchNoResults(trimmed)
      }
    }

    pendingRef.current = emit
    pendingSinceRef.current = Date.now()
    const timer = setTimeout(() => {
      pendingRef.current = null
      emit()
    }, SEARCH_SETTLE_MS)

    // Only the timer is dropped here. The pending emission survives a query change
    // because the next run overwrites it — and survives unmount, where the flush
    // below claims it.
    return () => clearTimeout(timer)
  }, [query, resultCount, trackerKind, searchSource, degraded])

  useEffect(
    () => () => {
      // Leaving the page mid-settle (clicking a brand card) is the highest-intent
      // search there is, not a prefix typed through. Flush it. The dedup guard
      // inside `emit` keeps this from doubling a query the timer already sent.
      if (Date.now() - pendingSinceRef.current >= FLUSH_MIN_AGE_MS) {
        pendingRef.current?.()
      }
      pendingRef.current = null
    },
    [],
  )

  return null
}
