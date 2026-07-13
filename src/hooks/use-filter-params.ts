'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useMemo, useTransition } from 'react'
import {
  parsePageParam,
  parseSortParam,
  type BrandSortOption,
} from '@/lib/pagination'

/**
 * Manages search, page, and sort state via URL search params.
 * Search is stored in ?search=term, page in ?page=N, sort in ?sort=name|newest|year
 */
export function useFilterParams() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

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

  const buildUrl = useCallback(
    (params: URLSearchParams) => {
      const str = params.toString()
      return str ? `${pathname}?${str}` : pathname
    },
    [pathname]
  )

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('search')
    params.delete('page')
    startTransition(() => {
      router.push(buildUrl(params), { scroll: false })
    })
  }, [router, buildUrl, searchParams])

  const setPage = useCallback(
    (page: number) => {
      const params = new URLSearchParams(searchParams.toString())
      if (page <= 1) {
        params.delete('page')
      } else {
        params.set('page', String(page))
      }
      startTransition(() => {
        router.push(buildUrl(params), { scroll: false })
      })
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
      startTransition(() => {
        router.push(buildUrl(params), { scroll: false })
      })
    },
    [router, buildUrl, searchParams]
  )

  const setSearch = useCallback(
    (term: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (term) {
        params.set('search', term)
      } else {
        params.delete('search')
      }
      params.delete('page')
      if (params.toString() === searchParams.toString()) return
      startTransition(() => {
        router.push(buildUrl(params), { scroll: false })
      })
    },
    [router, buildUrl, searchParams]
  )

  return {
    clearFilters,
    currentPage,
    currentSort,
    filters: { search: currentSearch },
    isPending,
    setPage,
    setSort,
    setSearch,
  }
}
