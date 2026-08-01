'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'

import { useInView } from '@/hooks/use-in-view'
import { trackBrandDetailEngaged, type EngagementTrigger } from '@/lib/analytics'

export type { EngagementTrigger }

/** A visitor who lingers this long has read something, not bounced. */
const DWELL_MS = 15_000

type BrandEngagementContextValue = {
  reportEngagement: (trigger: EngagementTrigger) => void
}

const BrandEngagementContext = createContext<BrandEngagementContextValue | null>(
  null,
)

type BrandEngagementTrackerProps = {
  brandId?: string
  slug: string
  children: ReactNode
}

export function BrandEngagementTracker({
  brandId,
  slug,
  children,
}: BrandEngagementTrackerProps) {
  // One engagement per mount: the first qualifying trigger wins and every later
  // call is a no-op, so dwell/scroll timers racing a click cannot double-count.
  const firedRef = useRef(false)

  const reportEngagement = useCallback(
    (trigger: EngagementTrigger) => {
      if (firedRef.current) return
      firedRef.current = true
      trackBrandDetailEngaged(slug, trigger, brandId)
    },
    [brandId, slug],
  )

  useEffect(() => {
    const timer = setTimeout(() => reportEngagement('dwell'), DWELL_MS)
    return () => clearTimeout(timer)
  }, [reportEngagement])

  // Sentinel sits at the 50% mark of the page content; seeing it means the
  // visitor scrolled at least halfway.
  const { ref: halfwayRef, inView: halfwayInView } = useInView<HTMLDivElement>({
    threshold: 0,
    once: true,
  })

  useEffect(() => {
    if (halfwayInView) reportEngagement('scroll_50')
  }, [halfwayInView, reportEngagement])

  const value = useMemo(() => ({ reportEngagement }), [reportEngagement])

  return (
    <BrandEngagementContext.Provider value={value}>
      <div className="relative">
        {children}
        <div
          ref={halfwayRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-1/2 h-px w-px"
        />
      </div>
    </BrandEngagementContext.Provider>
  )
}

/**
 * Safe outside a provider: consumers such as the gallery and channel list also
 * render on pages that never mount the tracker, and must not crash there.
 */
export function useBrandEngagement(): BrandEngagementContextValue {
  const context = useContext(BrandEngagementContext)

  if (context === null) {
    return { reportEngagement: () => {} }
  }

  return context
}
