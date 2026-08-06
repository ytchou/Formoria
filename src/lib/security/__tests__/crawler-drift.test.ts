import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportCrawlerChallenged, reportCrawlerRateLimited, reportCrawlerVerificationDisagreement, resetCrawlerDriftForTests } from '../crawler-drift'
import { captureAlert } from '@/lib/adapters/alerting/sentry'

vi.mock('@/lib/adapters/alerting/sentry', () => ({ captureAlert: vi.fn(() => true) }))

afterEach(() => {
  resetCrawlerDriftForTests()
  vi.clearAllMocks()
})

describe('crawler drift alarms', () => {
  it('emits a disagreement event when UA says crawler and header does not', () => {
    reportCrawlerVerificationDisagreement({ crawlerName: 'Googlebot', userAgentClaimsCrawler: true, verified: false })
    expect(captureAlert).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ level: 'warning' }))
  })

  it('does not emit when both agree', () => {
    reportCrawlerVerificationDisagreement({ crawlerName: 'Googlebot', userAgentClaimsCrawler: true, verified: true })
    expect(captureAlert).not.toHaveBeenCalled()
  })

  it('emits an alert event when a registry-matched UA receives a 429', () => {
    reportCrawlerRateLimited({ crawlerName: 'Googlebot', pathname: '/brands/example' })
    expect(captureAlert).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ level: 'error' }))
  })

  it('emits an alert event when a registry-matched UA is redirected to /challenge', () => {
    reportCrawlerChallenged({ crawlerName: 'Googlebot', pathname: '/brands/example' })
    expect(captureAlert).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ level: 'error' }))
  })

  it('emission never throws into the request path', () => {
    vi.mocked(captureAlert).mockImplementation(() => { throw new Error('sentry unavailable') })
    expect(() => {
      reportCrawlerVerificationDisagreement({ crawlerName: 'Googlebot', userAgentClaimsCrawler: true, verified: false })
      reportCrawlerRateLimited({ crawlerName: 'Googlebot', pathname: '/brands/example' })
      reportCrawlerChallenged({ crawlerName: 'Googlebot', pathname: '/brands/example' })
    }).not.toThrow()
  })
})
