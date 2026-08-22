import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'
import { RATE_LIMIT_STORE_HEADER } from '@/lib/security/rate-limit-observability'
import { resetOriginGuardWarningForTests } from '@/lib/security/origin-guard'

function healthRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://formoria.com/api/health', { headers })
}

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const response = await GET(healthRequest())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ status: 'ok', rateLimitStore: 'ok', originGuard: 'inactive' })
  })

  it('returns application/json content type', async () => {
    const response = await GET(healthRequest())
    expect(response.headers.get('content-type')).toContain('application/json')
  })

  // Railway health-checks this endpoint. A degraded limiter fails open, so the
  // probe must stay green -- failing it would block the redeploy that fixes the
  // limiter.
  it('stays 200 and ok while reporting a degraded rate-limit store', async () => {
    const response = await GET(healthRequest({ [RATE_LIMIT_STORE_HEADER]: 'degraded' }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ status: 'ok', rateLimitStore: 'degraded', originGuard: 'inactive' })
  })

  it('falls back to ok for an unrecognised header value', async () => {
    const response = await GET(healthRequest({ [RATE_LIMIT_STORE_HEADER]: 'DEGRADED-ish' }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ status: 'ok', rateLimitStore: 'ok', originGuard: 'inactive' })
  })

  /**
   * DEV-1551. A blank CF_ORIGIN_SECRET in production leaves the Cloudflare
   * origin guard off. That stays non-blocking on purpose -- a deploy that is
   * not behind Cloudflare must not 403 itself into an outage -- so this field
   * is the only durable way an external monitor learns the origin is exposed.
   */
  describe('origin guard reporting', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      resetOriginGuardWarningForTests()
    })

    it('health reports originGuard: "disabled" when CF_ORIGIN_SECRET is blank in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('CF_ORIGIN_SECRET', '')

      const body = await (await GET(healthRequest())).json()
      expect(body.originGuard).toBe('disabled')
    })

    it('reports enabled when the secret is set in production', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('CF_ORIGIN_SECRET', 'edge-secret')

      const body = await (await GET(healthRequest())).json()
      expect(body.originGuard).toBe('enabled')
    })

    it('stays 200 while reporting a disabled origin guard', async () => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubEnv('CF_ORIGIN_SECRET', '')

      const response = await GET(healthRequest())
      expect(response.status).toBe(200)
      expect((await response.json()).status).toBe('ok')
    })
  })
})
