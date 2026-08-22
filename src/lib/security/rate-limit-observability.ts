import { after } from 'next/server'
import { ANALYTICS_EVENTS } from '@/lib/analytics/events'

/**
 * Rate-limit store telemetry, kept in its own module for two reasons.
 *
 * 1. It runs in the edge runtime. On 2026-08-13 the Upstash quota was exhausted,
 *    the limiter 500ed every rule-matched route, and nothing alerted: Sentry's
 *    Node SDK is not loaded in the edge runtime, and Railway's log pipeline had
 *    already dropped hundreds of messages by the time anyone looked. PostHog
 *    ingest is a plain `fetch`, so it is the one sink that works from here.
 * 2. Imports are deliberately light. This module is pulled in by both the edge
 *    middleware and `/api/health`, and the header constant below lives here --
 *    not in `rate-limiter.ts` -- so the health route does not drag the Upstash
 *    SDK and the module-level limiter construction into its bundle.
 */

/**
 * Request header the proxy stamps so `/api/health` can report breaker state.
 * Middleware and route handlers are separate isolates, so the route cannot read
 * the limiter's module-scoped breaker directly.
 */
export const RATE_LIMIT_STORE_HEADER = 'x-formoria-rate-limit-store'

/**
 * One stable PostHog identity for limiter telemetry; it must never become a
 * person. Mirrors the convention in `analytics/server-supply-events.ts`, which
 * pairs a `formoria:service:*` distinct id with `$process_person_profile: false`.
 */
const RATE_LIMITER_SERVICE_DISTINCT_ID = 'formoria:service:rate-limiter'

type TelemetryTransport = (event: string, properties: Record<string, unknown>) => Promise<void>

async function postToPostHog(event: string, properties: Record<string, unknown>): Promise<void> {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST
  // Missing config is not an error worth logging: preview environments and unit
  // runs have no PostHog project, and a warning per failed limiter call would
  // reproduce the log flood this telemetry exists to replace.
  if (!token || !host) return

  const normalizedHost = host.replace(/\/+$/, '')
  // `/e/` specifically: that is the path `posthog-js` already posts to, so it is
  // proven through the `e.formoria.com` reverse proxy. `/capture/` is not.
  await fetch(`${normalizedHost}/e/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: token,
      event,
      distinct_id: RATE_LIMITER_SERVICE_DISTINCT_ID,
      properties,
      timestamp: new Date().toISOString(),
    }),
  })
}

let transport: TelemetryTransport = postToPostHog

/**
 * Test seam: swap the transport so suites never issue a real network call.
 * Passing null restores the PostHog fetch transport.
 */
export function setRateLimitTelemetryTransportForTests(fn: TelemetryTransport | null): void {
  transport = fn ?? postToPostHog
}

/**
 * Fire and forget. Mirrors `scheduleFlush()` in `crawler-telemetry.ts`: `after()`
 * runs the send once the response is on the wire, and outside a request scope
 * (unit tests, or any future non-request caller) it throws, so fall back to a
 * detached promise. Either way the request never waits on telemetry, and a
 * rejected send never surfaces.
 */
function emit(event: string, properties: Record<string, unknown>): void {
  try {
    const promise = transport(event, properties).catch(() => {})
    try {
      after(() => promise)
      return
    } catch {
      // No request scope; the detached promise below still drains.
    }
    void promise.catch(() => {})
  } catch {
    // Telemetry must never throw into the request path -- the limiter's whole
    // point at this moment is that it is already failing open.
    return
  }
}

export function reportRateLimitStoreUnavailable(input: {
  errorMessage: string
  cooldownMs: number
}): void {
  emit(ANALYTICS_EVENTS.RATE_LIMIT_STORE_UNAVAILABLE, {
    error_message: input.errorMessage,
    cooldown_ms: input.cooldownMs,
    $process_person_profile: false,
  })
}

export function reportRateLimitStoreRecovered(input: {
  cooldownMs: number
  outageMs: number
}): void {
  emit(ANALYTICS_EVENTS.RATE_LIMIT_STORE_RECOVERED, {
    cooldown_ms: input.cooldownMs,
    outage_ms: input.outageMs,
    $process_person_profile: false,
  })
}

/** Reason codes for `RATE_LIMIT_BLOCKED`. */
export type RateLimitBlockReason = 'hard_limit_exceeded' | 'soft_limit_challenge'

/**
 * Every block, not only registry-matched crawlers. `crawler-drift.ts` already
 * reports a blocked crawler to Sentry, but an unrecognised client -- which is
 * most of what a limiter blocks -- produced no signal at all, so there was
 * nothing to calibrate enforcement thresholds against.
 *
 * `ipKey` must already be hashed by the caller; a raw IP must never reach here.
 */
export function reportRateLimitBlocked(input: {
  routeFamily: string
  ipKey: string
  reason: RateLimitBlockReason
}): void {
  emit(ANALYTICS_EVENTS.RATE_LIMIT_BLOCKED, {
    route_family: input.routeFamily,
    ip_key: input.ipKey,
    reason: input.reason,
    $process_person_profile: false,
  })
}
