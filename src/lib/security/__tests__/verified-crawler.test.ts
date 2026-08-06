import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { checkRateLimit } from '../rate-limiter'
import { isVerifiedCrawler, VERIFIED_BOT_HEADER } from '../verified-crawler'

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
  })

  afterEach(() => {
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

  it('hard limiter uses the UA path while SHADOW is on', async () => {
    process.env.VERIFIED_CRAWLER_SHADOW = 'true'
    expect(await hardLimit(request('Googlebot/2.1'))).toBeNull()
  })

  it('hard limiter uses the header path when SHADOW is off', async () => {
    process.env.VERIFIED_CRAWLER_SHADOW = 'off'
    expect(await hardLimit(request('Mozilla/5.0', '1'))).toBeNull()
  })

  it('a UA-claimed Googlebot gets no exemption once shadow is off', async () => {
    process.env.VERIFIED_CRAWLER_SHADOW = '0'
    expect((await hardLimit(request('Googlebot/2.1')))?.status).toBe(429)
  })

  it('trustedUnverified crawlers keep their exemption once shadow is off', async () => {
    process.env.VERIFIED_CRAWLER_SHADOW = 'false'
    expect(await hardLimit(request('ChatGPT-User/1.0'))).toBeNull()
  })

  it('a UA-claimed crawler without trustedUnverified gets no exemption', async () => {
    process.env.VERIFIED_CRAWLER_SHADOW = 'OFF'
    expect((await hardLimit(request('Bingbot/2.0')))?.status).toBe(429)
  })
})
