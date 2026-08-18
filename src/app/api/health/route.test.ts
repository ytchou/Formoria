import { describe, it, expect } from 'vitest'
import { GET } from './route'
import { RATE_LIMIT_STORE_HEADER } from '@/lib/security/rate-limit-observability'

function healthRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://formoria.com/api/health', { headers })
}

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const response = await GET(healthRequest())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ status: 'ok', rateLimitStore: 'ok' })
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
    expect(body).toEqual({ status: 'ok', rateLimitStore: 'degraded' })
  })

  it('falls back to ok for an unrecognised header value', async () => {
    const response = await GET(healthRequest({ [RATE_LIMIT_STORE_HEADER]: 'DEGRADED-ish' }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ status: 'ok', rateLimitStore: 'ok' })
  })
})
