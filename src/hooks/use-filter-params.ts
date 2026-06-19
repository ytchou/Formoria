'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  parsePageParam,
  parseSortParam,
  type BrandSortOption,
} from '@/lib/pagination'

/**
 * Manages taxonomy filter, page, and sort state via URL search params.
 * Filters are serialized as comma-separated tag slugs in ?tags=slug1,slug2
 * Page is stored in ?page=N, sort in ?sort=name|newest|year
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

  const currentPage = useMemo(
    () => parsePageParam(searchParams.get('page') ?? undefined),
    [searchParams]
  )

  const currentSort = useMemo(
    () => parseSortParam(searchParams.get('sort') ?? undefined),
    [searchParams]
  )

  const currentSearch = useMemo(
    () => searchParams.get('search') ?? '',
    [searchParams]
  )

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [])

  const buildUrl = useCallback(
    (params: URLSearchParams) => {
      const str = params.toString()
      return str ? `${pathname}?${str}` : pathname
    },
    [pathname]
  )

  const setFilters = useCallback(
    (slugs: string[]) => {
      const params = new URLSearchParams(searchParams.toString())
      if (slugs.length === 0) {
        params.delete('tags')
      } else {
        params.set('tags', slugs.join(','))
      }
      // Reset page when filters change
      params.delete('page')
      router.push(buildUrl(params), { scroll: false })
    },
    [router, buildUrl, searchParams]
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
    const params = new URLSearchParams(searchParams.toString())
    params.delete('tags')
    params.delete('search')
    params.delete('page')
    router.push(buildUrl(params), { scroll: false })
  }, [router, buildUrl, searchParams])

  const setPage = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString())
      if (page <= 1) {
        params.delete('page')
      } else {
        params.set('page', String(page))
      }
      router.push(buildUrl(params), { scroll: false })
    },
    [router, buildUrl, searchParams]
  )

  const setSort = useCallback(
    (sort: BrandSortOption) => {
      const params = new URLSearchParams(searchParams.toString())
      if (sort === 'random') {
        params.delete('sort')
      } else {
        params.set('sort', sort)
      }
      // Reset page when sort changes
      params.delete('page')
      router.push(buildUrl(params), { scroll: false })
    },
    [router, buildUrl, searchParams]
  )

  const setSearch = useCallback(
    (term: string) => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)

      searchTimeoutRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString())
        if (term) {
          params.set('search', term)
        } else {
          params.delete('search')
        }
        params.delete('page')
        router.push(buildUrl(params), { scroll: false })
      }, 300)
    },
    [router, buildUrl, searchParams]
  )

  return {
    selectedSlugs,
    toggleSlug,
    clearFilters,
    activeCount: selectedSlugs.length,
    currentPage,
    currentSort,
    filters: { search: currentSearch },
    setPage,
    setSort,
    setSearch,
  }
}
