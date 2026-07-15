'use client'

import { useEffect, useRef } from 'react'
import { trackBrandDetailViewed } from '@/lib/analytics'

type BrandViewSource = 'search' | 'category' | 'directory' | 'direct' | 'recommendation'

interface BrandViewTrackerProps {
  brandSlug: string
}

const BRAND_VIEW_SOURCES = new Set<BrandViewSource>([
  'search',
  'category',
  'directory',
  'direct',
  'recommendation',
])

export function BrandViewTracker({ brandSlug }: BrandViewTrackerProps) {
  const trackedRef = useRef<string | null>(null)

  useEffect(() => {
    if (trackedRef.current === brandSlug) return
    trackedRef.current = brandSlug
    const rawSource = new URLSearchParams(window.location.search).get('source')
    const source = rawSource && BRAND_VIEW_SOURCES.has(rawSource as BrandViewSource)
      ? (rawSource as BrandViewSource)
      : 'direct'
    trackBrandDetailViewed(brandSlug, source)
  }, [brandSlug])

  return null
}
