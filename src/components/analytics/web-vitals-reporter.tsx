'use client'

import { useCallback } from 'react'
import { useReportWebVitals } from 'next/web-vitals'
import { trackWebVital } from '@/lib/analytics'
import { isPostHogConfigured } from '@/lib/analytics/posthog-provider'

/** Metric shape Next hands the reporter. Derived from the hook's own signature so
 *  it tracks upstream changes instead of hand-rolling the field list. */
type WebVitalMetric = Parameters<Parameters<typeof useReportWebVitals>[0]>[0]

/**
 * Reports Core Web Vitals field data to PostHog. Kept as a leaf client component
 * so the root layout stays a server component — mounting the hook in the layout
 * itself would pull the whole tree client-side.
 */
export function WebVitalsReporter() {
  // Stable identity: `useReportWebVitals` deps on the callback and never cleans up
  // its listeners, so an inline arrow re-registers observers on every render and
  // each metric would be captured N times.
  const report = useCallback((metric: WebVitalMetric) => {
    // No provider is ever registered when PostHog is unconfigured, so every metric
    // would sit in the pending-capture buffer (capped at 50, shifting) and evict
    // genuinely queued product events. Local dev and CI stay silent by construction.
    if (!isPostHogConfigured()) return
    trackWebVital(metric)
  }, [])

  useReportWebVitals(report)

  return null
}
