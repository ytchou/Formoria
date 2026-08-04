'use client'

import { useCallback } from 'react'
import { useReportWebVitals } from 'next/web-vitals'
import * as Sentry from '@sentry/nextjs'
import { trackWebVital } from '@/lib/analytics'
import { isPostHogConfigured } from '@/lib/analytics/posthog-provider'

/** Metric shape Next hands the reporter. Derived from the hook's own signature so
 *  it tracks upstream changes instead of hand-rolling the field list. */
type WebVitalMetric = Parameters<Parameters<typeof useReportWebVitals>[0]>[0]

/** Once per page load — a misconfiguration is one fact, not one fact per metric. */
let missingProviderReported = false

/**
 * PostHog is the only sink for field CWV, and the release gate leans on that
 * field data to override a failing lab score. If the integration ever lapses in
 * production the numbers do not go bad, they go *absent* — which reads exactly
 * like silence and would let the gate pass on no evidence at all (DEV-1337).
 */
function reportMissingProvider() {
  if (missingProviderReported || process.env.NODE_ENV !== 'production') return
  missingProviderReported = true
  Sentry.captureMessage(
    'Web vitals reporting is disabled: PostHog is not configured in production',
    'warning',
  )
}

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
    if (!isPostHogConfigured()) {
      reportMissingProvider()
      return
    }
    trackWebVital(metric)
  }, [])

  useReportWebVitals(report)

  return null
}
