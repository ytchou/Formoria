import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resetAuditEmitterForTests, setAuditWriteSeam, type AuditRecord } from '@/lib/audit'
import { verifyTurnstileToken } from '../turnstile'

describe('verifyTurnstileToken', () => {
  const originalEnv = process.env.TURNSTILE_SECRET_KEY
  const originalNodeEnv = process.env.NODE_ENV
  let writes: AuditRecord[]

  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret-key'
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('PLAYWRIGHT_TEST', 'false')
    vi.stubEnv('SECURITY_STUB_TURNSTILE', 'false')
    writes = []
    setAuditWriteSeam(async (record) => {
      writes.push(record)
      return null
    })
  })

  afterEach(() => {
    process.env.TURNSTILE_SECRET_KEY = originalEnv
    vi.stubEnv('NODE_ENV', originalNodeEnv)
    resetAuditEmitterForTests()
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
    // The legacy flag still reaches the gate through the fallback in
    // `test-gates.ts`, so a runner that exports only this keeps working. The
    // new switch has to be UNSET for the fallback to apply.
    vi.stubEnv('SECURITY_STUB_TURNSTILE', '')
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

  it('skips verification when SECURITY_STUB_TURNSTILE is set on its own', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PLAYWRIGHT_TEST', 'false')
    vi.stubEnv('SECURITY_STUB_TURNSTILE', 'true')
    const fetchSpy = vi.spyOn(global, 'fetch')

    const result = await verifyTurnstileToken('test-token', undefined, 'formoria.com')

    expect(result.success).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  /**
   * DEV-1551 task 17. The short-circuit at the top of `verifyTurnstileToken`
   * used to fire on `PLAYWRIGHT_TEST=true`, the SAME flag that disabled the rate
   * limiter -- so an e2e project could never exercise real Turnstile while the
   * limiter stayed off. `SECURITY_STUB_TURNSTILE=false` now turns this gate back
   * on by itself.
   */
  it('calls the real endpoint when stubbing is off', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    // Both the legacy flag and the limiter switch say "test run"...
    vi.stubEnv('PLAYWRIGHT_TEST', 'true')
    vi.stubEnv('SECURITY_DISABLE_RATE_LIMIT', 'true')
    // ...and Turnstile is still verified for real.
    vi.stubEnv('SECURITY_STUB_TURNSTILE', 'false')
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    )

    const result = await verifyTurnstileToken('test-token', undefined, 'formoria.com')

    expect(result.success).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({ method: 'POST' }),
    )
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

  it('turnstile span never records the token', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }),
        { status: 200 },
      ),
    )

    await verifyTurnstileToken('sensitive-token', '1.2.3.4', 'formoria.com')

    const auditJson = JSON.stringify(writes)
    expect(auditJson).toContain('"tokenLength":15')
    expect(auditJson).toContain('"httpStatus":200')
    expect(auditJson).toContain('"status":"rejected"')
    expect(auditJson).not.toContain('sensitive-token')
    expect(auditJson).not.toContain('test-secret-key')
    expect(auditJson).not.toContain('1.2.3.4')
  })
})
