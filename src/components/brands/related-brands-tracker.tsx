'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { trackRecommendationSectionViewed } from '@/lib/analytics'

interface RelatedBrandsTrackerProps {
  sourceBrandSlug: string
  count: number
  children: ReactNode
}

export function RelatedBrandsTracker({ sourceBrandSlug, count, children }: RelatedBrandsTrackerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const firedRef = useRef(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !firedRef.current) {
            firedRef.current = true
            trackRecommendationSectionViewed(sourceBrandSlug, count)
          }
        }
      },
      { threshold: 0.5 },
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [sourceBrandSlug, count])

  return <div ref={ref}>{children}</div>
}
