'use client'

import { useEffect, useRef } from 'react'
import { trackBrandDetailViewed } from '@/lib/analytics'

type BrandViewSource = 'search' | 'category' | 'directory' | 'direct' | 'recommendation'

interface BrandViewTrackerProps {
  brandSlug: string
  source?: BrandViewSource
}

export function BrandViewTracker({ brandSlug, source = 'direct' }: BrandViewTrackerProps) {
  const trackedRef = useRef<string | null>(null)

  useEffect(() => {
    if (trackedRef.current === brandSlug) return
    trackedRef.current = brandSlug
    trackBrandDetailViewed(brandSlug, source)
  }, [brandSlug, source])

  return null
}
