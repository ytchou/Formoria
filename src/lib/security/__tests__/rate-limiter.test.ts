import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { CRAWLER_REGISTRY } from '../crawler-registry'
import {
  checkRateLimit,
  checkSoftRateLimit,
  createInMemoryRateLimiter,
  evaluateCrawlerChallengeAlarm,
  evaluateCrawlerRateLimitAlarm,
  isLikelyCrawler,
  setRateLimitStoreForTests,
  type RateLimitStore,
} from '../rate-limiter'
import { getCrawlerDisagreementCount, resetCrawlerDriftForTests } from '../crawler-drift'
import { resetVerifiedCrawlerStateForTests } from '../verified-crawler'
import { captureAlert } from '@/lib/adapters/alerting/sentry'

vi.mock('@/lib/adapters/alerting/sentry', () => ({ captureAlert: vi.fn(() => true) }))

describe('InMemoryRateLimiter', () => {
  let limiter: RateLimitStore

  beforeEach(() => {
    vi.useFakeTimers()
    limiter = createInMemoryRateLimiter()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows requests within the limit', () => {
    const result = limiter.check('user-1', 60_000, 5)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('blocks requests after exceeding the limit', () => {
    for (let i = 0; i < 5; i++) {
      limiter.check('user-1', 60_000, 5)
    }
    const result = limiter.check('user-1', 60_000, 5)
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.resetAt).toBeGreaterThan(Date.now())
  })

  it('allows requests after window expires', () => {
    for (let i = 0; i < 5; i++) {
      limiter.check('user-1', 60_000, 5)
    }
    vi.advanceTimersByTime(61_000)
    const result = limiter.check('user-1', 60_000, 5)
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it('tracks different keys independently', () => {
    for (let i = 0; i < 5; i++) {
      limiter.check('user-1', 60_000, 5)
    }
    const result = limiter.check('user-2', 60_000, 5)
    expect(result.allowed).toBe(true)
  })

  it('applies sliding window correctly', () => {
    limiter.check('user-1', 60_000, 3)
    vi.advanceTimersByTime(20_000)
    limiter.check('user-1', 60_000, 3)
    vi.advanceTimersByTime(20_000)
    limiter.check('user-1', 60_000, 3)
    // 3 requests in 40s window — at limit
    const blocked = limiter.check('user-1', 60_000, 3)
    expect(blocked.allowed).toBe(false)
    // Advance past first request's window
    vi.advanceTimersByTime(21_000)
    const allowed = limiter.check('user-1', 60_000, 3)
    expect(allowed.allowed).toBe(true)
  })
})

describe('crawler rate-limit boundaries', () => {
  let ip = 0

  beforeEach(() => {
    // Pin the backing store: the module-level limiter is otherwise selected at
    // import time from ambient UPSTASH_REDIS_REST_URL/TOKEN, which makes every
    // assertion below depend on the environment the suite happens to run in.
    setRateLimitStoreForTests(createInMemoryRateLimiter())
    resetCrawlerDriftForTests()
    resetVerifiedCrawlerStateForTests()
    vi.mocked(captureAlert).mockClear()
  })

  afterEach(() => {
    setRateLimitStoreForTests(null)
    resetCrawlerDriftForTests()
    resetVerifiedCrawlerStateForTests()
  })

  function request(path: string, userAgent: string): NextRequest {
    ip += 1
    return new NextRequest(`https://formoria.com${path}`, {
      headers: {
        'user-agent': userAgent,
        'x-forwarded-for': `198.51.100.${ip}`,
      },
    })
  }

  it('never soft-challenges a request whose UA matches any registry crawler', async () => {
    const cases = [
      ['Googlebot', 'Googlebot/2.1'],
      ['Google-InspectionTool', 'Google-InspectionTool/1.0'],
      ['AdsBot-Google', 'AdsBot-Google/1.0'],
      ['LINE', 'Linespider/1.0'],
      ['Threadsbot', 'Threadsbot/1.0'],
      ['Meta-ExternalFetcher', 'meta-externalfetcher/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'],
      ['facebookexternalhit', 'facebookexternalhit/1.1'],
      ['Slackbot', 'Slackbot 1.0'],
    ] as const

    for (const [, userAgent] of cases) {
      const crawlerRequest = request('/brands/x', userAgent)
      for (let i = 0; i < 200; i += 1) {
        expect(await checkSoftRateLimit(crawlerRequest)).toBe(false)
      }
    }
  })

  it('still soft-challenges a normal browser past the limit', async () => {
    const browserRequest = request(
      '/brands/x',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    )

    let challenged = false
    for (let i = 0; i < 200; i += 1) {
      challenged = (await checkSoftRateLimit(browserRequest)) || challenged
    }
    expect(challenged).toBe(true)
  })

  it('isLikelyCrawler matches every registry uaPattern', () => {
    for (const entry of CRAWLER_REGISTRY) {
      const userAgent = entry.name === 'LINE' ? 'Linespider/1.0' : `${entry.name}/1.0`
      expect(isLikelyCrawler(request('/brands/x', userAgent))).toBe(true)
    }
  })

  it('hard rate limit still applies to a UA-claimed crawler', async () => {
    const crawlerRequest = request('/api/data', 'Googlebot/2.1')

    let response: Response | null = null
    for (let i = 0; i < 61; i += 1) {
      response = await checkRateLimit(crawlerRequest)
    }
    expect(response?.status).toBe(429)
  })

  it('rate-limits a spoofed crawler UA on /sitemap.xml — the 3/min budget is not exemptible', async () => {
    // CCBot is one of the tokens this branch added to the registry. The sitemap
    // budget exists to stop sitemap scraping, so the crawler exemption must not
    // reach it however the UA header is set.
    const crawlerRequest = request('/sitemap.xml', 'CCBot/2.0 (https://commoncrawl.org/faq/)')

    let response: Response | null = null
    for (let i = 0; i < 4; i += 1) {
      response = await checkRateLimit(crawlerRequest)
    }
    expect(response?.status).toBe(429)
  })
})

describe('exact brand directory rate limit', () => {
  const directoryLimit = 30
  const configuredDetailLimit = Number(process.env.RATE_LIMIT_BRANDS_PER_MIN)
  const detailLimit = Number.isFinite(configuredDetailLimit) && configuredDetailLimit > 0 ? configuredDetailLimit : 200

  beforeEach(() => {
    setRateLimitStoreForTests(createInMemoryRateLimiter())
  })

  afterEach(() => {
    setRateLimitStoreForTests(null)
  })

  function request(path: string, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest(`https://formoria.com${path}`, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
        'x-forwarded-for': '198.51.100.240',
        ...headers,
      },
    })
  }

  it('allows 30 exact-index requests and returns a standard HTML 429 on request 31', async () => {
    for (let requestNumber = 1; requestNumber <= directoryLimit; requestNumber += 1) {
      expect(await checkRateLimit(request('/en/brands'))).toBeNull()
    }

    const response = await checkRateLimit(request('/en/brands'))

    expect(response?.status).toBe(429)
    expect(response?.headers.get('Retry-After')).toMatch(/^\d+$/)
    expect(response?.headers.get('X-RateLimit-Limit')).toBe(String(directoryLimit))
    expect(response?.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(response?.headers.get('X-RateLimit-Reset')).toMatch(/^\d+$/)
    expect(response?.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
    if (!response) throw new Error('Expected a rate-limit response')
    await expect(response.text()).resolves.toContain('Too Many Requests')
  })

  it('normalizes locales into one exact-index budget', async () => {
    for (let requestNumber = 1; requestNumber <= directoryLimit; requestNumber += 1) {
      expect(await checkRateLimit(request('/brands'))).toBeNull()
    }

    expect((await checkRateLimit(request('/zh-TW/brands')))?.status).toBe(429)
  })

  it('keeps the detail-page budget separate from the directory budget', async () => {
    for (let requestNumber = 1; requestNumber <= detailLimit; requestNumber += 1) {
      expect(await checkRateLimit(request('/brands/example'))).toBeNull()
    }

    const response = await checkRateLimit(request('/brands/example'))

    expect(response?.status).toBe(429)
    expect(response?.headers.get('X-RateLimit-Limit')).toBe(String(detailLimit))
  })

  it('does not consume the directory budget for Next router requests', async () => {
    const routerHeaders = { accept: '*/*' }

    for (let requestNumber = 1; requestNumber <= directoryLimit; requestNumber += 1) {
      expect(await checkRateLimit(request('/en/brands'))).toBeNull()
    }

    expect(await checkRateLimit(request('/en/brands', routerHeaders))).toBeNull()
    expect((await checkRateLimit(request('/en/brands')))?.status).toBe(429)
  })

  it('does not exempt a Googlebot User-Agent from the exact-index budget', async () => {
    const crawlerHeaders = { 'user-agent': 'Googlebot/2.1' }

    for (let requestNumber = 1; requestNumber <= directoryLimit; requestNumber += 1) {
      expect(await checkRateLimit(request('/en/brands', crawlerHeaders))).toBeNull()
    }

    expect((await checkRateLimit(request('/en/brands', crawlerHeaders)))?.status).toBe(429)
  })

  it('does not match near-prefix paths', async () => {
    for (let requestNumber = 1; requestNumber <= directoryLimit + 1; requestNumber += 1) {
      expect(await checkRateLimit(request('/brands-extra'))).toBeNull()
    }
  })
})

/**
 * The plan hard-gates the shadow flip on observing both alarms fire. Each test
 * here drives the alarm's real stated condition, not a path that only passes
 * because it is dead.
 */
describe('crawler alarm reachability', () => {
  let ip = 0

  function request(path: string, userAgent: string): NextRequest {
    ip += 1
    return new NextRequest(`https://formoria.com${path}`, {
      headers: { 'user-agent': userAgent, 'x-forwarded-for': `192.0.2.${ip}` },
    })
  }

  beforeEach(() => {
    setRateLimitStoreForTests(createInMemoryRateLimiter())
    resetCrawlerDriftForTests()
    resetVerifiedCrawlerStateForTests()
    vi.mocked(captureAlert).mockClear()
  })

  afterEach(() => {
    setRateLimitStoreForTests(null)
    resetCrawlerDriftForTests()
    resetVerifiedCrawlerStateForTests()
  })

  it('fires the rate-limit alarm through the real limiter when a registry crawler gets a 429', async () => {
    const crawlerRequest = request('/api/data', 'Googlebot/2.1')
    for (let i = 0; i < 61; i += 1) await checkRateLimit(crawlerRequest)

    expect(captureAlert).toHaveBeenCalledWith(
      'Registry crawler received a rate-limit response',
      expect.objectContaining({
        level: 'error',
        context: expect.objectContaining({ crawlerName: 'Googlebot', pathname: '/api/data' }),
      }),
    )
  })

  it('does not fire the rate-limit alarm for a non-registry UA', async () => {
    const browserRequest = request('/api/data', 'Mozilla/5.0 (Macintosh) Chrome/131.0.0.0 Safari/537.36')
    for (let i = 0; i < 61; i += 1) await checkRateLimit(browserRequest)
    expect(captureAlert).not.toHaveBeenCalled()
  })

  it('fires the challenge alarm when a registry crawler would be challenged', () => {
    expect(evaluateCrawlerChallengeAlarm('Googlebot/2.1', '/brands/example')).toBe(true)
    expect(captureAlert).toHaveBeenCalledWith(
      'Registry crawler was challenged',
      expect.objectContaining({
        level: 'error',
        context: expect.objectContaining({ crawlerName: 'Googlebot', pathname: '/brands/example' }),
      }),
    )
  })

  it('both alarms stay silent for a UA no registry entry matches', () => {
    expect(evaluateCrawlerChallengeAlarm('Mozilla/5.0 Chrome/131.0.0.0', '/brands/example')).toBe(false)
    expect(evaluateCrawlerRateLimitAlarm('Mozilla/5.0 Chrome/131.0.0.0', '/brands/example')).toBe(false)
    expect(captureAlert).not.toHaveBeenCalled()
  })

  it('a spoofing client cannot turn either alarm into one Sentry event per request', async () => {
    const spoofed = request('/api/data', 'Googlebot/2.1')
    for (let i = 0; i < 400; i += 1) await checkRateLimit(spoofed)
    for (let i = 0; i < 400; i += 1) evaluateCrawlerChallengeAlarm('Googlebot/2.1', '/brands/example')
    // One per alarm per 60s window, not one per request.
    expect(captureAlert).toHaveBeenCalledTimes(2)
  })

  /*
   * The disagreement counter is the metric the VERIFIED_CRAWLER_SHADOW flip is
   * judged on: a step change in it is the only signal that the Cloudflare
   * transform rule has silently stopped matching. Every other test reaches the
   * counter by calling the reporter directly, which would keep passing even if
   * checkRateLimit stopped calling it at all. This one drives the real limiter.
   */
  it('counts a verification disagreement through the real limiter on /brands/', async () => {
    expect(getCrawlerDisagreementCount('Googlebot')).toBe(0)

    await checkRateLimit(request('/brands/example', 'Googlebot/2.1'))

    expect(getCrawlerDisagreementCount('Googlebot')).toBe(1)
  })

  it('counts no disagreement when the crawler presents the verified header', async () => {
    const verified = new NextRequest('https://formoria.com/brands/example', {
      headers: {
        'user-agent': 'Googlebot/2.1',
        'x-forwarded-for': '192.0.2.240',
        'x-formoria-verified-bot': '1',
      },
    })

    await checkRateLimit(verified)

    expect(getCrawlerDisagreementCount('Googlebot')).toBe(0)
  })

  it('counts no disagreement for a browser UA', async () => {
    await checkRateLimit(request('/brands/example', 'Mozilla/5.0 (Macintosh) Chrome/131.0.0.0'))

    expect(getCrawlerDisagreementCount('Googlebot')).toBe(0)
  })
})
