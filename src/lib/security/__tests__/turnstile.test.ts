import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifyTurnstileToken } from '../turnstile'

describe('verifyTurnstileToken', () => {
  const originalEnv = process.env.TURNSTILE_SECRET_KEY
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret-key'
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('PLAYWRIGHT_TEST', 'false')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    process.env.TURNSTILE_SECRET_KEY = originalEnv
    vi.stubEnv('NODE_ENV', originalNodeEnv)
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('returns success when Cloudflare verifies the token', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    )
    const result = await verifyTurnstileToken('valid-token')
    expect(result.success).toBe(true)
  })

  it('returns failure when Cloudflare rejects the token', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: false,
          'error-codes': ['invalid-input-response'],
        }),
        { status: 200 }
      )
    )
    const result = await verifyTurnstileToken('bad-token')
    expect(result.success).toBe(false)
    expect(result.errorCodes).toContain('invalid-input-response')
  })

  it('fails closed when Cloudflare returns a non-success HTTP status', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 503 }),
    )

    const result = await verifyTurnstileToken('valid-token')

    expect(result.success).toBe(false)
  })

  it('fails closed when Cloudflare returns a malformed success value', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: 'true' }), { status: 200 }),
    )

    const result = await verifyTurnstileToken('valid-token')

    expect(result.success).toBe(false)
  })

  it('skips verification when TURNSTILE_SECRET_KEY is not set', async () => {
    delete process.env.TURNSTILE_SECRET_KEY
    const result = await verifyTurnstileToken('any-token')
    expect(result.success).toBe(true)
  })

  it('skips verification for localhost outside production', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    const result = await verifyTurnstileToken('any-token', undefined, 'localhost:3000')

    expect(result.success).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not skip localhost verification in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    )

    const result = await verifyTurnstileToken('valid-token', undefined, 'localhost:3000')

    expect(result.success).toBe(true)
    expect(fetchSpy).toHaveBeenCalled()
  })

  it('skips verification for the production Playwright test server', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PLAYWRIGHT_TEST', 'true')
    const fetchSpy = vi.spyOn(global, 'fetch')

    const result = await verifyTurnstileToken(
      'test-token',
      undefined,
      'localhost:3010',
    )

    expect(result.success).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not bypass verification for E2E_USER_EMAIL alone', async () => {
    vi.stubEnv('E2E_USER_EMAIL', 'e2e-user@example.com')
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    )

    const result = await verifyTurnstileToken('test-token')

    expect(result.success).toBe(true)
    expect(fetchSpy).toHaveBeenCalled()
  })

  it('returns failure on network error', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'))
    const result = await verifyTurnstileToken('valid-token')
    expect(result.success).toBe(false)
  })

  it('sends correct payload to Cloudflare', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    )
    await verifyTurnstileToken('test-token', '1.2.3.4')
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(URLSearchParams),
        signal: expect.any(AbortSignal),
      })
    )
    const body = fetchSpy.mock.calls[0][1]?.body as URLSearchParams
    expect(body.get('secret')).toBe('test-secret-key')
    expect(body.get('response')).toBe('test-token')
    expect(body.get('remoteip')).toBe('1.2.3.4')
  })

  it('audits the redacted request, provider response, latency, and status', async () => {
    const auditSpy = vi.mocked(console.info)
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }),
        { status: 200 },
      ),
    )

    await verifyTurnstileToken('sensitive-token', '1.2.3.4', 'formoria.com')

    expect(auditSpy).toHaveBeenCalledWith(
      '[turnstile:audit]',
      expect.objectContaining({
        request: {
          tokenLength: 15,
          remoteIpProvided: true,
          requestHost: 'formoria.com',
        },
        response: {
          httpStatus: 200,
          success: false,
          errorCodes: ['invalid-input-response'],
        },
        latencyMs: expect.any(Number),
        status: 'rejected',
      }),
    )
    expect(JSON.stringify(auditSpy.mock.calls)).not.toContain('sensitive-token')
    expect(JSON.stringify(auditSpy.mock.calls)).not.toContain('test-secret-key')
    expect(JSON.stringify(auditSpy.mock.calls)).not.toContain('1.2.3.4')
  })
})
