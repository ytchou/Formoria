'use client'

import { useEffect, useRef } from 'react'
import { trackBrandDetailViewed, trackSavedBrandRevisited } from '@/lib/analytics'
import { useSavedBrands } from '@/hooks/use-saved-brands'

type BrandViewSource = 'search' | 'category' | 'directory' | 'direct' | 'recommendation'

interface BrandViewTrackerProps {
  brandId?: string
  brandSlug: string
}

const BRAND_VIEW_SOURCES = new Set<BrandViewSource>([
  'search',
  'category',
  'directory',
  'direct',
  'recommendation',
])

export function BrandViewTracker({ brandId, brandSlug }: BrandViewTrackerProps) {
  const trackedRef = useRef<string | null>(null)
  const revisitTrackedRef = useRef(false)
  const { savedIds, loading: savedLoading } = useSavedBrands()

  useEffect(() => {
    if (trackedRef.current === brandSlug) return
    trackedRef.current = brandSlug
    const rawSource = new URLSearchParams(window.location.search).get('source')
    const source = rawSource && BRAND_VIEW_SOURCES.has(rawSource as BrandViewSource)
      ? (rawSource as BrandViewSource)
      : 'direct'
    trackBrandDetailViewed(brandSlug, source, brandId)
  }, [brandId, brandSlug])

  // Saved state arrives asynchronously, so this cannot ride along with the view
  // emission above: wait for the fetch to settle, then fire at most once per mount.
  useEffect(() => {
    if (savedLoading || revisitTrackedRef.current) return
    if (!brandId || !savedIds.has(brandId)) return
    revisitTrackedRef.current = true
    trackSavedBrandRevisited(brandSlug, 'detail_page', brandId)
  }, [brandId, brandSlug, savedIds, savedLoading])

  return null
}
