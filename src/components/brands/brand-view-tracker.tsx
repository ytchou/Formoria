'use client'

import { useEffect, useRef } from 'react'
import { trackBrandView } from '@/lib/analytics'

interface BrandViewTrackerProps {
  brandSlug: string
}

export function BrandViewTracker({ brandSlug }: BrandViewTrackerProps) {
  const trackedRef = useRef<string | null>(null)

  useEffect(() => {
    if (trackedRef.current === brandSlug) return
    trackedRef.current = brandSlug
    trackBrandView(brandSlug)
  }, [brandSlug])

  return null
}
