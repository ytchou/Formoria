import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { checkRateLimit, createInMemoryRateLimiter, setRateLimitStoreForTests } from '../rate-limiter'
import { resetCrawlerDriftForTests } from '../crawler-drift'
import {
  isCrawlerVerificationEnforced,
  isVerifiedCrawler,
  resetVerifiedCrawlerStateForTests,
  VERIFIED_BOT_HEADER,
} from '../verified-crawler'

const originalShadow = process.env.VERIFIED_CRAWLER_SHADOW
let ip = 0

function request(userAgent: string, verified?: string): NextRequest {
  ip += 1
  const headers = new Headers({
    'user-agent': userAgent,
    'x-forwarded-for': `198.51.100.${ip}`,
  })
  if (verified !== undefined) headers.set(VERIFIED_BOT_HEADER, verified)
  return new NextRequest('https://formoria.com/brands/example', { headers })
}

/**
 * Enforcement is interlocked on having seen the Cloudflare header at least
 * once, so every "shadow is off" test has to prove the transform rule exists
 * before the flag means anything. The interlock itself is covered separately.
 */
function armVerifiedHeader(): void {
  isVerifiedCrawler({ headers: { get: (name) => (name === VERIFIED_BOT_HEADER ? '1' : null) } })
}

// The /brands/ budget is env-tunable (RATE_LIMIT_BRANDS_PER_MIN), so derive the
// loop bound rather than hardcoding it -- same posture as
// `middleware-soft-rate-limit.test.ts`. One request past the budget is a 429 for
// a non-exempt caller and still null for an exempt one.
const configuredBrandsLimit = Number(process.env.RATE_LIMIT_BRANDS_PER_MIN)
const BRANDS_LIMIT = Number.isFinite(configuredBrandsLimit) && configuredBrandsLimit > 0 ? configuredBrandsLimit : 200

async function hardLimit(requestToCheck: NextRequest): Promise<Response | null> {
  let response: Response | null = null
  for (let attempt = 0; attempt <= BRANDS_LIMIT; attempt += 1) {
    response = await checkRateLimit(requestToCheck)
  }
  return response
}

describe('verified crawler policy', () => {
  beforeEach(() => {
    ip = 0
    delete process.env.VERIFIED_CRAWLER_SHADOW
    // Pin the store: without this the suite silently runs against Upstash or the
    // in-memory fallback depending on ambient UPSTASH_* env.
    setRateLimitStoreForTests(createInMemoryRateLimiter())
    resetVerifiedCrawlerStateForTests()
    resetCrawlerDriftForTests()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    setRateLimitStoreForTests(null)
    resetVerifiedCrawlerStateForTests()
    resetCrawlerDriftForTests()
    vi.restoreAllMocks()
    if (originalShadow === undefined) delete process.env.VERIFIED_CRAWLER_SHADOW
    else process.env.VERIFIED_CRAWLER_SHADOW = originalShadow
  })

  it('returns true only for the exact header value set by Cloudflare', () => {
    expect(isVerifiedCrawler(request('Googlebot/2.1', '1'))).toBe(true)
    for (const value of ['true', '0', '']) {
      expect(isVerifiedCrawler(request('Googlebot/2.1', value))).toBe(false)
    }
    expect(isVerifiedCrawler(request('Googlebot/2.1'))).toBe(false)
  })

  it('ignores a client-supplied header when shadow mode is on', async () => {
    process.env.VERIFIED_CRAWLER_SHADOW = 'on'
    expect(await hardLimit(request('Googlebot/2.1', '0'))).toBeNull()
  })

  it('a spoofed verified header buys no exemption while shadow is on', async () => {
    // The dangerous direction: a plain browser UA supplying the header itself.
    // Shadow mode decides on the UA, so the forged header changes nothing.
    process.env.VERIFIED_CRAWLER_SHADOW = 'on'
    expect((await hardLimit(request('Mozilla/5.0 (Macintosh) Chrome/131.0.0.0 Safari/537.36', '1')))?.status).toBe(429)
  })

  it('a spoofed verified header is only trusted once shadow is off, and only behind Cloudflare', async () => {
    // Once shadow is off the header DOES decide, so a direct-to-origin client
    // supplying it buys the exemption. That is safe only because the origin is
    // reachable exclusively through Cloudflare, which overwrites the header on
    // every request. This test pins that dependency: if the origin boundary is
    // ever removed, this is the spoofing hole it reopens.
    armVerifiedHeader()
    process.env.VERIFIED_CRAWLER_SHADOW = 'off'
    expect(await hardLimit(request('Mozilla/5.0 (Macintosh) Chrome/131.0.0.0 Safari/537.36', '1'))).toBeNull()
    // ...and without the header the same browser is limited normally.
    expect((await hardLimit(request('Mozilla/5.0 (Macintosh) Chrome/131.0.0.0 Safari/537.36')))?.status).toBe(429)
  })

  it('hard limiter uses the UA path while SHADOW is on', async () => {
    process.env.VERIFIED_CRAWLER_SHADOW = 'true'
    expect(await hardLimit(request('Googlebot/2.1'))).toBeNull()
  })

  it('hard limiter uses the header path when SHADOW is off', async () => {
    armVerifiedHeader()
    process.env.VERIFIED_CRAWLER_SHADOW = 'off'
    expect(await hardLimit(request('Mozilla/5.0', '1'))).toBeNull()
  })

  it('a UA-claimed Googlebot gets no exemption once shadow is off', async () => {
    armVerifiedHeader()
    process.env.VERIFIED_CRAWLER_SHADOW = '0'
    expect((await hardLimit(request('Googlebot/2.1')))?.status).toBe(429)
  })

  it('trustedUnverified crawlers keep their exemption once shadow is off', async () => {
    armVerifiedHeader()
    process.env.VERIFIED_CRAWLER_SHADOW = 'false'
    expect(await hardLimit(request('ChatGPT-User/1.0'))).toBeNull()
  })

  it('a UA-claimed crawler without trustedUnverified gets no exemption', async () => {
    armVerifiedHeader()
    process.env.VERIFIED_CRAWLER_SHADOW = 'OFF'
    expect((await hardLimit(request('Bingbot/2.0')))?.status).toBe(429)
  })

  it('protected routes stay excluded from every exemption', async () => {
    // The privilege boundary: no crawler path may reach /api/ or /admin/.
    armVerifiedHeader()
    for (const shadow of ['on', 'off']) {
      process.env.VERIFIED_CRAWLER_SHADOW = shadow
      for (const [userAgent, verified] of [
        ['Googlebot/2.1', undefined],
        ['ChatGPT-User/1.0', undefined],
        ['Googlebot/2.1', '1'],
      ] as const) {
        ip += 1
        const headers = new Headers({ 'user-agent': userAgent, 'x-forwarded-for': `203.0.113.${ip}` })
        if (verified !== undefined) headers.set(VERIFIED_BOT_HEADER, verified)
        const apiRequest = new NextRequest('https://formoria.com/api/data', { headers })
        let response: Response | null = null
        for (let attempt = 0; attempt <= 60; attempt += 1) response = await checkRateLimit(apiRequest)
        expect(response?.status).toBe(429)
      }
    }
  })
})

describe('shadow-flip safety interlock', () => {
  beforeEach(() => {
    ip = 0
    setRateLimitStoreForTests(createInMemoryRateLimiter())
    resetVerifiedCrawlerStateForTests()
    resetCrawlerDriftForTests()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    setRateLimitStoreForTests(null)
    resetVerifiedCrawlerStateForTests()
    resetCrawlerDriftForTests()
    vi.restoreAllMocks()
    if (originalShadow === undefined) delete process.env.VERIFIED_CRAWLER_SHADOW
    else process.env.VERIFIED_CRAWLER_SHADOW = originalShadow
  })

  it('refuses to enforce while the Cloudflare header has never been observed', () => {
    process.env.VERIFIED_CRAWLER_SHADOW = 'off'
    expect(isCrawlerVerificationEnforced()).toBe(false)
    expect(console.warn).toHaveBeenCalledTimes(1)
    // Warns loudly, but only once — this is evaluated on every request.
    expect(isCrawlerVerificationEnforced()).toBe(false)
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('enforces once the header has been observed', () => {
    process.env.VERIFIED_CRAWLER_SHADOW = 'off'
    armVerifiedHeader()
    expect(isCrawlerVerificationEnforced()).toBe(true)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('keeps Googlebot exempt when the flag is flipped before the transform rule ships', async () => {
    // Without the interlock this is a 429 — Googlebot has no trustedUnverified
    // carve-out, so a premature flip drops it into the public bucket.
    process.env.VERIFIED_CRAWLER_SHADOW = 'off'
    expect(await hardLimit(request('Googlebot/2.1'))).toBeNull()
  })
})
