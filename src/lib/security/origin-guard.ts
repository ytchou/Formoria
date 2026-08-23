/**
 * Cloudflare origin-guard state, in its own module for the same reason
 * `rate-limit-observability.ts` holds the store header: `/api/health` needs to
 * report on it, and importing `src/proxy.ts` from a route handler would drag
 * the Supabase and Upstash graphs into that route's bundle.
 */

/**
 * - `enabled`  — production with a secret set; the guard 403s unsigned traffic.
 * - `disabled` — production with a BLANK secret; the guard is a no-op and the
 *   origin is reachable directly, bypassing Cloudflare.
 * - `inactive` — not production; the guard never runs by design.
 */
export type OriginGuardState = 'enabled' | 'disabled' | 'inactive'

/**
 * Mirrors the `process.env.NODE_ENV === 'production' && cfOriginSecret`
 * condition in `src/proxy.ts` exactly, including its plain truthiness test --
 * a state report that disagreed with the guard it describes would be worse
 * than no report.
 */
export function getOriginGuardState(): OriginGuardState {
  if (process.env.NODE_ENV !== 'production') return 'inactive'
  return process.env.CF_ORIGIN_SECRET ? 'enabled' : 'disabled'
}

let warned = false

/**
 * A blank secret must keep NOT blocking: a deploy that is not behind Cloudflare
 * would otherwise 403 itself into a total outage on first boot. But silence is
 * the actual hazard here -- the guard simply stops existing and nothing says
 * so. Warn once at module scope, and let `/api/health` carry the durable state
 * for an external monitor.
 */
export function warnIfOriginGuardDisabled(): void {
  if (warned) return
  if (getOriginGuardState() !== 'disabled') return
  warned = true
  // console.warn rather than the Sentry adapter: this runs in the edge runtime
  // at module scope, where the Node SDK is not loaded.
  console.warn(
    JSON.stringify({
      event: 'origin_guard_disabled',
      reason: 'CF_ORIGIN_SECRET is blank in production',
      impact: 'the Railway origin accepts requests that did not pass Cloudflare',
    }),
  )
}

/** Test seam: the warning is once-per-process, so suites must be able to rearm it. */
export function resetOriginGuardWarningForTests(): void {
  warned = false
}
