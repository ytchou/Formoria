import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockGetClientIp,
  mockRateLimit,
  mockSignChallengeToken,
  mockVerifyTurnstileToken,
} = vi.hoisted(() => ({
  mockGetClientIp: vi.fn(),
  mockRateLimit: vi.fn(),
  mockSignChallengeToken: vi.fn(),
  mockVerifyTurnstileToken: vi.fn(),
}))

vi.mock('@/lib/security/challenge', () => ({
  CHALLENGE_COOKIE_NAME: 'fm_verified',
  CHALLENGE_TTL_SECONDS: 604_800,
  signChallengeToken: mockSignChallengeToken,
}))

vi.mock('@/lib/security/rate-limiter', () => ({
  getClientIp: mockGetClientIp,
  rateLimit: mockRateLimit,
}))

vi.mock('@/lib/security/turnstile', () => ({
  verifyTurnstileToken: mockVerifyTurnstileToken,
}))

import { POST } from './route'

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('https://formoria.com/api/challenge/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/challenge/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetClientIp.mockReturnValue('203.0.113.8')
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 })
    mockVerifyTurnstileToken.mockResolvedValue({ success: true })
    mockSignChallengeToken.mockResolvedValue('signed-challenge-token')
  })

  it('sets the verification cookie and preserves a safe return path', async () => {
    const response = await POST(makeRequest({
      token: 'verified-token',
      returnTo: '/brands/talkoo?source=search',
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ redirectTo: '/brands/talkoo?source=search' })
    expect(response.headers.get('set-cookie')).toContain('fm_verified=signed-challenge-token')
    expect(mockVerifyTurnstileToken).toHaveBeenCalledWith(
      'verified-token',
      '203.0.113.8',
      'formoria.com',
    )
  })

  it.each([
    ['absolute URL', 'https://attacker.example/path'],
    ['protocol-relative URL', '//attacker.example/path'],
    ['backslash-based URL', '/\\attacker.example/path'],
    ['control-character URL', '/\t/attacker.example/path'],
    ['non-string value', { pathname: '/brands/talkoo' }],
  ])('falls back to home for an unsafe %s', async (_label, returnTo) => {
    const response = await POST(makeRequest({ token: 'verified-token', returnTo }))

    expect(await response.json()).toEqual({ redirectTo: '/' })
  })

  it('rejects a missing token before calling Turnstile', async () => {
    const response = await POST(makeRequest({ returnTo: '/brands/talkoo' }))

    expect(response.status).toBe(400)
    expect(mockVerifyTurnstileToken).not.toHaveBeenCalled()
    expect(mockSignChallengeToken).not.toHaveBeenCalled()
  })

  it('rejects a failed Turnstile verification without setting a cookie', async () => {
    mockVerifyTurnstileToken.mockResolvedValueOnce({ success: false })

    const response = await POST(makeRequest({
      token: 'rejected-token',
      returnTo: '/brands/talkoo',
    }))

    expect(response.status).toBe(400)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(mockSignChallengeToken).not.toHaveBeenCalled()
  })

  /**
   * DEV-1551. `rateLimit` used to call the limiter directly, so an unreachable
   * Upstash rejected and the rejection escaped as a 500 -- locking every
   * challenged visitor out of the site during a store outage. It now goes
   * through the same fail-open breaker the middleware uses.
   *
   * The real implementation is imported with `importActual` and installed as
   * the mock body, so this exercises the actual breaker rather than a stub of
   * it.
   */
  it('/api/challenge/verify returns 200 with a dead store', async () => {
    const actualLimiter = await vi.importActual<
      typeof import('@/lib/security/rate-limiter')
    >('@/lib/security/rate-limiter')
    const observability = await import('@/lib/security/rate-limit-observability')
    observability.setRateLimitTelemetryTransportForTests(async () => {})
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    actualLimiter.setRateLimitStoreForTests({
      check: () => {
        throw new Error('ERR max requests limit exceeded')
      },
    } as never)
    mockRateLimit.mockImplementation(actualLimiter.rateLimit)

    try {
      const response = await POST(makeRequest({
        token: 'verified-token',
        returnTo: '/brands/talkoo',
      }))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ redirectTo: '/brands/talkoo' })
    } finally {
      actualLimiter.setRateLimitStoreForTests(null)
      observability.setRateLimitTelemetryTransportForTests(null)
      consoleError.mockRestore()
    }
  })

  it('rejects rate-limited verification before reading the token', async () => {
    mockRateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    })

    const response = await POST(makeRequest({
      token: 'verified-token',
      returnTo: '/brands/talkoo',
    }))

    expect(response.status).toBe(429)
    expect(mockVerifyTurnstileToken).not.toHaveBeenCalled()
    expect(mockSignChallengeToken).not.toHaveBeenCalled()
  })
})
