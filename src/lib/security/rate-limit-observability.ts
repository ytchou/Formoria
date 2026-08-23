import { after } from 'next/server'
import { ANALYTICS_EVENTS } from '@/lib/analytics/events'
// Type-only: erased at build time, so the "keep imports light" rule below still
// holds and `/api/health` does not pull the traversal store into its bundle.
import type { EnforcementAction, EnforcementDecision } from './enforcement'

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

/**
 * Non-reversible client key for security telemetry. FNV-1a because the edge
 * runtime has no synchronous digest and a block decision must not await one;
 * this is a bucketing key for counting distinct clients, NOT a privacy boundary
 * against an attacker who can enumerate the IPv4 space. Ceiling: fine for volume
 * calibration. Upgrade path: if this key is ever joined against user data,
 * replace it with a keyed SHA-256 computed off the request path.
 *
 * Single owner: `rate-limiter.ts` and the enforcement ladder both call this, so
 * one client has one pseudonymous id across every event in this file.
 */
export function pseudonymizeIdentifier(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Reason codes for `RATE_LIMIT_BLOCKED`. */
export type RateLimitBlockReason =
  | 'hard_limit_exceeded'
  // Router traffic is metered against its own raised budget rather than being
  // waved through (DEV-1551). Separated from `hard_limit_exceeded` because the
  // two answer different questions: this one says a client is claiming to be
  // the Next.js router, which is the shape a scripted crawl takes.
  | 'router_limit_exceeded'
  | 'soft_limit_challenge'
  | 'verified_budget_exhausted'

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

/**
 * ENFORCEMENT LADDER TELEMETRY (DEV-1551).
 *
 * The ladder defaults to observe mode, so for the whole calibration period
 * these events are the ONLY output it produces. Thresholds are tuned from them
 * and the rollback trigger is defined against them; see
 * `docs/runbooks/anti-enumeration.md`.
 *
 * Privacy contract, enforced by test: no raw IP and no raw visitor id may be
 * placed on any payload below. Callers pass an already-pseudonymized key
 * (`pseudonymizeIdentifier`), and nothing here re-derives an identifier.
 */
const LADDER_EVENT_BY_ACTION: Record<EnforcementAction, string | null> = {
  // No event for `allow`: it fires on every request on the site, and the
  // denominator is already available from pageview volume.
  allow: null,
  record: ANALYTICS_EVENTS.SCRAPE_LADDER_RECORDED,
  challenge: ANALYTICS_EVENTS.SCRAPE_LADDER_CHALLENGED,
  block: ANALYTICS_EVENTS.SCRAPE_LADDER_BLOCKED,
  extended_block: ANALYTICS_EVENTS.SCRAPE_LADDER_EXTENDED_BLOCK,
}

/** The shared shape every ladder event carries. */
function ladderProperties(input: {
  identityKey: string
  decision: EnforcementDecision
}): Record<string, unknown> {
  return {
    identity_key: input.identityKey,
    identity_kind: input.decision.identityKind,
    route_family: input.decision.family,
    distinct_resources: input.decision.observed,
    window: input.decision.window,
    threshold: input.decision.threshold,
    reason: input.decision.reason,
    action: input.decision.action,
    effective_action: input.decision.effectiveAction,
    mode: input.decision.mode,
    $process_person_profile: false,
  }
}

/**
 * One event per non-allow decision, named for the rung.
 *
 * A shadowed decision emits a SECOND event. The rung event says what the ladder
 * concluded; `scrape_ladder_shadowed` says it was suppressed by observe mode.
 * Two events rather than one property because the rollback question -- "how much
 * would we have blocked if we flipped the switch?" -- has to be answerable
 * without remembering to filter on `mode`.
 */
export function reportEnforcementDecision(input: {
  identityKey: string
  decision: EnforcementDecision
}): void {
  const properties = ladderProperties(input)
  const rungEvent = LADDER_EVENT_BY_ACTION[input.decision.action]
  if (rungEvent) emit(rungEvent, properties)

  if (input.decision.shadowed) {
    emit(ANALYTICS_EVENTS.SCRAPE_LADDER_SHADOWED, properties)
  }

  if (input.decision.reason === 'verified_budget_exhausted') {
    emit(ANALYTICS_EVENTS.SCRAPE_VERIFIED_BUDGET_EXHAUSTED, properties)
  }
}

/**
 * A caller with no usable `fm_visitor` cookie is browsing behind an IP that has
 * already crossed the record threshold. Rotation is the cheapest evasion there
 * is, so this event is how the IP tier proves it is the thing holding.
 */
export function reportIdentityRotationSuspected(input: {
  identityKey: string
  routeFamily: string
  reason: string
}): void {
  emit(ANALYTICS_EVENTS.SCRAPE_IDENTITY_ROTATION_SUSPECTED, {
    identity_key: input.identityKey,
    route_family: input.routeFamily,
    reason: input.reason,
    $process_person_profile: false,
  })
}

/**
 * A verified crawler took the exemption. The counterpart to
 * `known_crawler_blocked`: together they answer whether the Cloudflare transform
 * rule is doing its job, which is the precondition for flipping
 * `VERIFIED_CRAWLER_SHADOW`.
 */
export function reportVerifiedCrawlerAllowed(input: {
  crawlerName: string | null
  routeFamily: string
  reason: string
}): void {
  emit(ANALYTICS_EVENTS.VERIFIED_CRAWLER_ALLOWED, {
    crawler_name: input.crawlerName,
    route_family: input.routeFamily,
    reason: input.reason,
    $process_person_profile: false,
  })
}

/**
 * A registry crawler was blocked or challenged. This is the deindexing alarm:
 * any sustained volume here means search engines are being turned away.
 */
export function reportKnownCrawlerBlocked(input: {
  crawlerName: string
  routeFamily: string
  reason: string
}): void {
  emit(ANALYTICS_EVENTS.KNOWN_CRAWLER_BLOCKED, {
    crawler_name: input.crawlerName,
    route_family: input.routeFamily,
    reason: input.reason,
    $process_person_profile: false,
  })
}

/**
 * A request arrived with a cookie that did not verify, so a fresh identity was
 * minted. A normal first visit produces one of these; a client producing them
 * repeatedly from one pseudonymous IP key is rotating on purpose.
 */
export function reportVisitorIdentityRotated(input: {
  identityKey: string
  routeFamily: string
  reason: string
}): void {
  emit(ANALYTICS_EVENTS.VISITOR_IDENTITY_ROTATED, {
    identity_key: input.identityKey,
    route_family: input.routeFamily,
    reason: input.reason,
    $process_person_profile: false,
  })
}

/**
 * The ladder ran against the DEGRADED in-memory store, or against no counters
 * at all. Distinct from `rate_limit_store_unavailable`, which reports the hard
 * limiter's breaker: this one says the enumeration numbers being alerted on are
 * per-isolate fractions and must not be trusted.
 */
export function reportRateLimiterDegraded(input: {
  reason: string
  storeKind: 'in-memory' | 'disabled'
}): void {
  emit(ANALYTICS_EVENTS.RATE_LIMITER_DEGRADED, {
    reason: input.reason,
    store_kind: input.storeKind,
    $process_person_profile: false,
  })
}
