import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ANALYTICS_EVENTS } from '@/lib/analytics/events'
import {
  checkRateLimit,
  checkSoftRateLimit,
  createInMemoryRateLimiter,
  observeTraversal,
  resetTraversalTelemetryLatchForTests,
  setRateLimitStoreForTests,
} from '../rate-limiter'
import {
  reportEnforcementDecision,
  reportIdentityRotationSuspected,
  reportKnownCrawlerBlocked,
  reportRateLimitStoreRecovered,
  reportRateLimitStoreUnavailable,
  reportRateLimiterDegraded,
  reportVerifiedCrawlerAllowed,
  reportVisitorIdentityRotated,
  setRateLimitTelemetryTransportForTests,
} from '../rate-limit-observability'
import type { EnforcementDecision } from '../enforcement'
import {
  createInMemoryTraversalStore,
  setTraversalStoreForTests,
} from '../traversal-counters'
import { signVisitorId, VISITOR_COOKIE_NAME } from '../visitor-identity'

const TOKEN_ENV = 'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN'
const HOST_ENV = 'NEXT_PUBLIC_POSTHOG_HOST'

type CapturedBody = {
  api_key: string
  event: string
  distinct_id: string
  properties: Record<string, unknown>
  timestamp: string
}

describe('rate-limit store telemetry', () => {
  let originalToken: string | undefined
  let originalHost: string | undefined
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalToken = process.env[TOKEN_ENV]
    originalHost = process.env[HOST_ENV]
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    setRateLimitTelemetryTransportForTests(null)
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env[TOKEN_ENV]
    else process.env[TOKEN_ENV] = originalToken
    if (originalHost === undefined) delete process.env[HOST_ENV]
    else process.env[HOST_ENV] = originalHost
  })

  function stubFetch(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch
    return fetchMock
  }

  it('issues no request when the PostHog token is missing', async () => {
    delete process.env[TOKEN_ENV]
    process.env[HOST_ENV] = 'https://e.formoria.com'
    const fetchMock = stubFetch()

    reportRateLimitStoreUnavailable({ errorMessage: 'quota exceeded', cooldownMs: 60_000 })
    await Promise.resolve()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('issues no request when the PostHog host is missing', async () => {
    process.env[TOKEN_ENV] = 'phc_test'
    delete process.env[HOST_ENV]
    const fetchMock = stubFetch()

    reportRateLimitStoreUnavailable({ errorMessage: 'quota exceeded', cooldownMs: 60_000 })
    await Promise.resolve()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the unavailable event to the proxied /e/ ingest path', async () => {
    process.env[TOKEN_ENV] = 'phc_test'
    // Trailing slash is stripped rather than producing a `//e/` path.
    process.env[HOST_ENV] = 'https://e.formoria.com/'
    const fetchMock = stubFetch()

    reportRateLimitStoreUnavailable({ errorMessage: 'quota exceeded', cooldownMs: 60_000 })
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls.at(0) as unknown as [string, RequestInit] | undefined
    if (!call) throw new Error('expected a PostHog ingest call')
    const [url, init] = call
    expect(url).toBe('https://e.formoria.com/e/')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')

    const body = JSON.parse(String(init.body)) as CapturedBody
    expect(body.api_key).toBe('phc_test')
    expect(body.event).toBe(ANALYTICS_EVENTS.RATE_LIMIT_STORE_UNAVAILABLE)
    // A service identity, never a person.
    expect(body.distinct_id).toBe('formoria:service:rate-limiter')
    expect(body.properties.$process_person_profile).toBe(false)
    expect(body.properties.error_message).toBe('quota exceeded')
    expect(body.properties.cooldown_ms).toBe(60_000)
  })

  it('carries outage_ms and cooldown_ms on the recovered event', async () => {
    const sent: Array<{ event: string; properties: Record<string, unknown> }> = []
    setRateLimitTelemetryTransportForTests(async (event, properties) => {
      sent.push({ event, properties })
    })

    reportRateLimitStoreRecovered({ cooldownMs: 60_000, outageMs: 61_000 })
    await Promise.resolve()

    expect(sent).toHaveLength(1)
    expect(sent[0]?.event).toBe(ANALYTICS_EVENTS.RATE_LIMIT_STORE_RECOVERED)
    expect(sent[0]?.properties).toMatchObject({
      cooldown_ms: 60_000,
      outage_ms: 61_000,
      $process_person_profile: false,
    })
  })

  it('does not throw when the transport rejects', async () => {
    setRateLimitTelemetryTransportForTests(async () => {
      throw new Error('ingest unreachable')
    })

    expect(() =>
      reportRateLimitStoreUnavailable({ errorMessage: 'quota exceeded', cooldownMs: 60_000 }),
    ).not.toThrow()
    expect(() =>
      reportRateLimitStoreRecovered({ cooldownMs: 60_000, outageMs: 61_000 }),
    ).not.toThrow()
    // Let the swallowed rejection settle so it cannot surface as an unhandled one.
    await Promise.resolve()
  })

  it('does not throw when the transport throws synchronously', () => {
    setRateLimitTelemetryTransportForTests((() => {
      throw new Error('boom')
    }) as unknown as (event: string, properties: Record<string, unknown>) => Promise<void>)

    expect(() =>
      reportRateLimitStoreUnavailable({ errorMessage: 'quota exceeded', cooldownMs: 60_000 }),
    ).not.toThrow()
  })
})

/**
 * DEV-1551. Until now the only signal on a block came from `crawler-drift.ts`,
 * which fires only when the User-Agent matches an entry in the crawler
 * registry. Unrecognised clients -- most of what a limiter actually blocks,
 * and the whole population an enforcement threshold has to be calibrated
 * against -- produced nothing at all.
 */
describe('rate-limit block telemetry', () => {
  const UNRECOGNIZED_UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'

  let events: Array<{ event: string; properties: Record<string, unknown> }>

  beforeEach(() => {
    events = []
    setRateLimitTelemetryTransportForTests(async (event, properties) => {
      events.push({ event, properties })
    })
    setRateLimitStoreForTests(createInMemoryRateLimiter())
  })

  afterEach(() => {
    setRateLimitStoreForTests(null)
    setRateLimitTelemetryTransportForTests(null)
  })

  function documentRequest(path: string, ip: string): NextRequest {
    return new NextRequest(`https://formoria.com${path}`, {
      headers: {
        'user-agent': UNRECOGNIZED_UA,
        'cf-connecting-ip': ip,
        accept: 'text/html',
      },
    })
  }

  function blockedEvents() {
    return events.filter((entry) => entry.event === ANALYTICS_EVENTS.RATE_LIMIT_BLOCKED)
  }

  /** `/admin/operations` carries the tightest budget in the table (3/min). */
  async function exhaustAdminBudget(ip: string): Promise<Response | null> {
    let blocked: Response | null = null
    for (let requestNumber = 0; requestNumber < 8; requestNumber += 1) {
      blocked = await checkRateLimit(documentRequest('/admin/operations', ip))
      if (blocked) break
    }
    return blocked
  }

  it('emits on a 429 for an unrecognized client', async () => {
    const blocked = await exhaustAdminBudget('198.51.100.77')

    expect(blocked?.status).toBe(429)
    expect(blockedEvents()).toHaveLength(1)
  })

  it('emits with route family, IP-derived key and reason code', async () => {
    await exhaustAdminBudget('198.51.100.78')

    const emitted = blockedEvents()[0]
    expect(emitted.properties.route_family).toBe('/admin')
    expect(emitted.properties.reason).toBe('hard_limit_exceeded')
    expect(emitted.properties.$process_person_profile).toBe(false)
    expect(typeof emitted.properties.ip_key).toBe('string')
    // A raw IP must never leave the limiter.
    expect(JSON.stringify(emitted.properties)).not.toContain('198.51.100.78')
  })

  it('does not emit on an allowed request', async () => {
    const allowed = await checkRateLimit(documentRequest('/admin/operations', '198.51.100.79'))

    expect(allowed).toBeNull()
    expect(blockedEvents()).toHaveLength(0)
  })

  it('emits a soft_limit_challenge reason when the Turnstile soft limit trips', async () => {
    const configured = Number(process.env.SOFT_LIMIT_BRANDS_PER_MIN)
    const budget = Number.isFinite(configured) && configured > 0 ? configured : 150

    let challenged = false
    for (let requestNumber = 0; requestNumber <= budget; requestNumber += 1) {
      challenged = await checkSoftRateLimit(documentRequest('/brands/talkoo', '198.51.100.80'))
    }

    expect(challenged).toBe(true)
    const soft = blockedEvents().filter(
      (entry) => entry.properties.reason === 'soft_limit_challenge',
    )
    expect(soft.length).toBeGreaterThan(0)
    expect(soft[0].properties.route_family).toBe('/brands')
  })
})

/**
 * DEV-1551 task 16. The enforcement ladder ships in log-only `observe` mode, so
 * these eleven events are its ONLY output until thresholds are calibrated. If
 * one of them stops firing, the ladder goes dark without anything failing.
 *
 * Alert thresholds, the rollback trigger and what a false positive looks like
 * are recorded in `docs/runbooks/anti-enumeration.md`.
 */
describe('enforcement ladder telemetry', () => {
  const RAW_IP = '198.51.100.201'
  const RAW_VISITOR_ID = '7f3a1c2e-9b04-4d51-8a6f-2c3d4e5f6a7b'

  let events: Array<{ event: string; properties: Record<string, unknown> }>

  beforeEach(() => {
    events = []
    setRateLimitTelemetryTransportForTests(async (event, properties) => {
      events.push({ event, properties })
    })
  })

  afterEach(() => {
    setRateLimitTelemetryTransportForTests(null)
    setTraversalStoreForTests(null)
    resetTraversalTelemetryLatchForTests()
    vi.unstubAllEnvs()
  })

  function names(): string[] {
    return events.map((entry) => entry.event)
  }

  function decisionFor(
    action: 'record' | 'challenge' | 'block' | 'extended_block',
    overrides: Partial<EnforcementDecision> = {},
  ): EnforcementDecision {
    return {
      action,
      effectiveAction: action,
      reason: 'block_threshold_exceeded',
      mode: 'enforce',
      shadowed: false,
      family: 'directory:detail',
      window: 'tenMinutes',
      identityKind: 'visitor',
      threshold: 160,
      observed: 412,
      ...overrides,
    }
  }

  it('emits all eleven scrape_/crawler events', async () => {
    for (const action of [
      'record',
      'challenge',
      'block',
      'extended_block',
    ] as const) {
      reportEnforcementDecision({ identityKey: 'abcd1234', decision: decisionFor(action) })
    }

    reportEnforcementDecision({
      identityKey: 'abcd1234',
      decision: decisionFor('block', { mode: 'observe', effectiveAction: 'allow', shadowed: true }),
    })
    reportEnforcementDecision({
      identityKey: 'abcd1234',
      decision: decisionFor('block', { reason: 'verified_budget_exhausted' }),
    })
    reportIdentityRotationSuspected({
      identityKey: 'abcd1234',
      routeFamily: 'directory:detail',
      reason: 'record_threshold_exceeded',
    })
    reportVerifiedCrawlerAllowed({
      crawlerName: 'Googlebot',
      routeFamily: 'directory:detail',
      reason: 'crawler_verified',
    })
    reportKnownCrawlerBlocked({
      crawlerName: 'Googlebot',
      routeFamily: 'directory:detail',
      reason: 'hard_limit_exceeded',
    })
    reportVisitorIdentityRotated({
      identityKey: 'abcd1234',
      routeFamily: 'directory:detail',
      reason: 'cookie_absent',
    })
    reportRateLimiterDegraded({ reason: 'upstash_env_missing', storeKind: 'in-memory' })
    await Promise.resolve()

    const emitted = new Set(names())
    for (const expected of [
      ANALYTICS_EVENTS.SCRAPE_LADDER_RECORDED,
      ANALYTICS_EVENTS.SCRAPE_LADDER_CHALLENGED,
      ANALYTICS_EVENTS.SCRAPE_LADDER_BLOCKED,
      ANALYTICS_EVENTS.SCRAPE_LADDER_EXTENDED_BLOCK,
      ANALYTICS_EVENTS.SCRAPE_LADDER_SHADOWED,
      ANALYTICS_EVENTS.SCRAPE_VERIFIED_BUDGET_EXHAUSTED,
      ANALYTICS_EVENTS.SCRAPE_IDENTITY_ROTATION_SUSPECTED,
      ANALYTICS_EVENTS.VERIFIED_CRAWLER_ALLOWED,
      ANALYTICS_EVENTS.KNOWN_CRAWLER_BLOCKED,
      ANALYTICS_EVENTS.VISITOR_IDENTITY_ROTATED,
      ANALYTICS_EVENTS.RATE_LIMITER_DEGRADED,
    ]) {
      expect(emitted.has(expected)).toBe(true)
    }
    // Eleven distinct constants, none of them an inline string literal.
    expect(emitted.size).toBe(11)
  })

  it('payload carries pseudonymous id, route family, distinct-resource count, window, threshold, reason code', async () => {
    reportEnforcementDecision({ identityKey: 'abcd1234', decision: decisionFor('block') })
    await Promise.resolve()

    const blocked = events.find(
      (entry) => entry.event === ANALYTICS_EVENTS.SCRAPE_LADDER_BLOCKED,
    )
    expect(blocked?.properties).toMatchObject({
      identity_key: 'abcd1234',
      identity_kind: 'visitor',
      route_family: 'directory:detail',
      distinct_resources: 412,
      window: 'tenMinutes',
      threshold: 160,
      reason: 'block_threshold_exceeded',
      action: 'block',
      effective_action: 'block',
      mode: 'enforce',
      $process_person_profile: false,
    })
  })

  it('does not emit a raw IP or a raw visitor id', async () => {
    vi.stubEnv('TRAVERSAL_COUNTERS', 'on')
    vi.stubEnv('CHALLENGE_SECRET', 'observability-test-secret')
    vi.stubEnv('ENFORCEMENT_RECORD_DISTINCT', '1')
    setTraversalStoreForTests(createInMemoryTraversalStore())
    resetTraversalTelemetryLatchForTests()

    const signed = await signVisitorId(RAW_VISITOR_ID)
    const request = new NextRequest('https://formoria.com/brands/talkoo', {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        'cf-connecting-ip': RAW_IP,
        cookie: `${VISITOR_COOKIE_NAME}=${signed}`,
      },
    })

    const evaluation = await observeTraversal(request, '/brands/talkoo')
    await Promise.resolve()

    // The path really ran: without this the assertions below pass vacuously.
    expect(evaluation).not.toBeNull()
    expect(events.length).toBeGreaterThan(0)

    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain(RAW_IP)
    expect(serialized).not.toContain(RAW_VISITOR_ID)
    expect(serialized).not.toContain(signed)
  })
})
