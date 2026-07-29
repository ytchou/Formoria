'use client'

import { useReportWebVitals } from 'next/web-vitals'
import { trackWebVital } from '@/lib/analytics'

/** Metric shape Next hands the reporter. Derived from the hook's own signature so
 *  it tracks upstream changes instead of hand-rolling the field list. */
type WebVitalMetric = Parameters<Parameters<typeof useReportWebVitals>[0]>[0]

// Mirrors the preconditions in instrumentation-client.ts that decide whether the
// PostHog client is ever initialized. Without them the provider is never
// registered and every metric would sit in the pending-capture buffer, so local
// dev and CI stay silent by construction.
const IS_SINK_CONFIGURED =
  process.env.NODE_ENV === 'production'
  && Boolean(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN)

/**
 * Reports Core Web Vitals field data to PostHog. Kept as a leaf client component
 * so the root layout stays a server component — mounting the hook in the layout
 * itself would pull the whole tree client-side.
 */
export function WebVitalsReporter() {
  useReportWebVitals((metric: WebVitalMetric) => {
    if (!IS_SINK_CONFIGURED) return
    trackWebVital(metric)
  })

  return null
}
