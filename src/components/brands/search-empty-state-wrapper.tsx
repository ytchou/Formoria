'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback } from 'react'
import { SearchEmptyState } from './search-empty-state'

interface SearchEmptyStateWrapperProps {
  query: string
  hasActiveFilters: boolean
  categories: { productType: string; count: number }[]
  featuredBrands: {
    id: string
    name: string
    slug: string
    heroImageUrl: string | null
    category: string
  }[]
}

export function SearchEmptyStateWrapper({
  query,
  hasActiveFilters,
  categories,
  featuredBrands,
}: SearchEmptyStateWrapperProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const handleClearFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    // Keep only the search query, remove all filter params
    const search = params.get('search')
    const newParams = new URLSearchParams()
    if (search) newParams.set('search', search)
    router.push(`/brands?${newParams.toString()}`)
  }, [router, searchParams])

  return (
    <SearchEmptyState
      query={query}
      hasActiveFilters={hasActiveFilters}
      categories={categories}
      featuredBrands={featuredBrands}
      onClearFilters={handleClearFilters}
    />
  )
}
