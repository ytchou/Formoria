import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCrawlerDisagreementCount,
  reportCrawlerChallenged,
  reportCrawlerRateLimited,
  reportCrawlerVerificationDisagreement,
  resetCrawlerDriftForTests,
} from '../crawler-drift'
import { isVerifiedCrawler, resetVerifiedCrawlerStateForTests, VERIFIED_BOT_HEADER } from '../verified-crawler'
import { captureAlert } from '@/lib/adapters/alerting/sentry'

vi.mock('@/lib/adapters/alerting/sentry', () => ({ captureAlert: vi.fn(() => true) }))

/**
 * The disagreement alarm is withheld until the Cloudflare transform rule has
 * been proven to exist. Tests that assert an emission have to arm that latch
 * first; the ones that assert suppression deliberately do not.
 */
function observeVerifiedHeader(): void {
  isVerifiedCrawler({ headers: { get: (name) => (name === VERIFIED_BOT_HEADER ? '1' : null) } })
}

beforeEach(() => {
  resetCrawlerDriftForTests()
  resetVerifiedCrawlerStateForTests()
})

afterEach(() => {
  resetCrawlerDriftForTests()
  resetVerifiedCrawlerStateForTests()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('crawler drift alarms', () => {
  it('emits a disagreement event when UA says crawler and header does not', () => {
    observeVerifiedHeader()
    reportCrawlerVerificationDisagreement({ crawlerName: 'Googlebot', userAgentClaimsCrawler: true, verified: false })
    expect(captureAlert).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ level: 'warning' }))
  })

  it('does not emit when both agree', () => {
    observeVerifiedHeader()
    reportCrawlerVerificationDisagreement({ crawlerName: 'Googlebot', userAgentClaimsCrawler: true, verified: true })
    expect(captureAlert).not.toHaveBeenCalled()
  })

  it('withholds the disagreement alert until the verified header has ever been seen', () => {
    for (let i = 0; i < 25; i += 1) {
      reportCrawlerVerificationDisagreement({ crawlerName: 'Googlebot', userAgentClaimsCrawler: true, verified: false })
    }
    expect(captureAlert).not.toHaveBeenCalled()
    // Counting still runs while the alert is withheld -- the rate is the witness
    // that detects the transform rule breaking after it ships.
    expect(getCrawlerDisagreementCount('Googlebot')).toBe(25)

    observeVerifiedHeader()
    reportCrawlerVerificationDisagreement({ crawlerName: 'Googlebot', userAgentClaimsCrawler: true, verified: false })
    expect(captureAlert).toHaveBeenCalledTimes(1)
    expect(getCrawlerDisagreementCount('Googlebot')).toBe(26)
  })

  it('emits an alert event when a registry-matched UA receives a 429', () => {
    reportCrawlerRateLimited({ crawlerName: 'Googlebot', pathname: '/brands/example' })
    expect(captureAlert).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ level: 'error' }))
  })

  it('emits an alert event when a registry-matched UA is redirected to /challenge', () => {
    reportCrawlerChallenged({ crawlerName: 'Googlebot', pathname: '/brands/example' })
    expect(captureAlert).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ level: 'error' }))
  })

  it('windows the rate-limit alarm so a spoofing client cannot flood Sentry', () => {
    vi.useFakeTimers()
    for (let i = 0; i < 500; i += 1) {
      reportCrawlerRateLimited({ crawlerName: 'Googlebot', pathname: '/api/data' })
    }
    expect(captureAlert).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60_001)
    reportCrawlerRateLimited({ crawlerName: 'Googlebot', pathname: '/api/data' })
    expect(captureAlert).toHaveBeenCalledTimes(2)
    // The second event reports what the closed window stood for.
    expect(captureAlert).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ context: expect.objectContaining({ windowCount: 500, suppressedCount: 499 }) }),
    )
  })

  it('windows the challenge alarm the same way', () => {
    vi.useFakeTimers()
    for (let i = 0; i < 200; i += 1) {
      reportCrawlerChallenged({ crawlerName: 'Googlebot', pathname: '/brands/example' })
    }
    expect(captureAlert).toHaveBeenCalledTimes(1)
  })

  it('windows each crawler independently', () => {
    reportCrawlerRateLimited({ crawlerName: 'Googlebot', pathname: '/api/data' })
    reportCrawlerRateLimited({ crawlerName: 'Bingbot', pathname: '/api/data' })
    reportCrawlerRateLimited({ crawlerName: 'Googlebot', pathname: '/api/data' })
    expect(captureAlert).toHaveBeenCalledTimes(2)
  })

  it('emission never throws into the request path', () => {
    observeVerifiedHeader()
    vi.mocked(captureAlert).mockImplementation(() => { throw new Error('sentry unavailable') })
    expect(() => {
      reportCrawlerVerificationDisagreement({ crawlerName: 'Googlebot', userAgentClaimsCrawler: true, verified: false })
      reportCrawlerRateLimited({ crawlerName: 'Googlebot', pathname: '/brands/example' })
      reportCrawlerChallenged({ crawlerName: 'Googlebot', pathname: '/brands/example' })
    }).not.toThrow()
  })
})
