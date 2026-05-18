'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useMemo } from 'react'

/**
 * Manages taxonomy filter state via URL search params.
 * Filters are serialized as comma-separated tag slugs in ?tags=slug1,slug2
 */
export function useFilterParams() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const selectedSlugs = useMemo<string[]>(() => {
    const raw = searchParams.get('tags')
    if (!raw) return []
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }, [searchParams])

  const setFilters = useCallback(
    (slugs: string[]) => {
      const params = new URLSearchParams(searchParams.toString())
      if (slugs.length === 0) {
        params.delete('tags')
      } else {
        params.set('tags', slugs.join(','))
      }
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    },
    [router, pathname, searchParams]
  )

  const toggleSlug = useCallback(
    (slug: string) => {
      const current = new Set(selectedSlugs)
      if (current.has(slug)) {
        current.delete(slug)
      } else {
        current.add(slug)
      }
      setFilters(Array.from(current))
    },
    [selectedSlugs, setFilters]
  )

  const clearFilters = useCallback(() => {
    setFilters([])
  }, [setFilters])

  return {
    selectedSlugs,
    toggleSlug,
    clearFilters,
    activeCount: selectedSlugs.length,
  }
}
