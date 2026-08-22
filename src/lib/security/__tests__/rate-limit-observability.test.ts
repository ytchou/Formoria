import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { ANALYTICS_EVENTS } from '@/lib/analytics/events'
import {
  checkRateLimit,
  checkSoftRateLimit,
  createInMemoryRateLimiter,
  setRateLimitStoreForTests,
} from '../rate-limiter'
import {
  reportRateLimitStoreRecovered,
  reportRateLimitStoreUnavailable,
  setRateLimitTelemetryTransportForTests,
} from '../rate-limit-observability'

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
