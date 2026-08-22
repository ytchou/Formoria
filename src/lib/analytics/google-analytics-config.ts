import { isStagingEnvironment } from '@/lib/deployment-environment'

/**
 * Single source of truth for whether the GA4 snippet may load.
 *
 * The environment conditions mirror `isPostHogConfigured()` in
 * `./posthog-provider` — a second convention for the same question is how one
 * analytics property ends up polluted while the other stays clean. Two
 * deliberate differences:
 *
 *  1. GA has no equivalent of PostHog's managed-host check. The measurement ID
 *     takes its place.
 *  2. Staging is detected with `isStagingEnvironment()` rather than by comparing
 *     `NEXT_PUBLIC_DEPLOYMENT_ENV` alone. Neither Railway service sets that
 *     variable today (staging signals itself only through
 *     `RAILWAY_ENVIRONMENT_NAME`), so the bare comparison PostHog uses would be
 *     true on staging and gate nothing. Keep this call: reverting to the single
 *     variable silently reopens the hole.
 *
 * The gate is a DENY-list, not an allow-list. Production sets no deployment-env
 * variable at all, so requiring `=== 'production'` would disable GA on the one
 * environment that must have it.
 *
 * Returning the ID rather than a boolean keeps the gate and the value that
 * passes it from drifting apart at the call site.
 *
 * Read from a server component only: `isStagingEnvironment()` inspects
 * non-public variables that are absent from the browser bundle.
 */
export function resolveGoogleAnalyticsId(): string | undefined {
  if (process.env.NODE_ENV !== 'production' || isStagingEnvironment()) {
    return undefined
  }

  return process.env.NEXT_PUBLIC_GA_ID || undefined
}
