import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/services/link-health', () => ({
  runLinkHealthCheck: vi.fn(),
}))

import { runLinkHealthCheck } from '@/lib/services/link-health'

describe('POST /api/cron/link-health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ORIGIN_SECRET', 'test-secret')
  })

  it('returns 401 without valid x-origin-verify header', async () => {
    const { POST } = await import('../route')
    const req = new Request('http://localhost/api/cron/link-health', {
      method: 'POST',
      headers: {},
    })

    const response = await POST(req)
    expect(response.status).toBe(401)
  })

  it('returns 401 with wrong x-origin-verify header', async () => {
    const { POST } = await import('../route')
    const req = new Request('http://localhost/api/cron/link-health', {
      method: 'POST',
      headers: { 'x-origin-verify': 'wrong-secret' },
    })

    const response = await POST(req)
    expect(response.status).toBe(401)
  })

  it('calls runLinkHealthCheck and returns 200 on success', async () => {
    vi.mocked(runLinkHealthCheck).mockResolvedValue({
      checked: 5,
      ok: 4,
      broken: 1,
      blocked: 0,
      autoNulled: [],
      heroBroken: [],
      heroExternal: [],
      failingRows: [],
      severity: 'warning',
    })

    const { POST } = await import('../route')
    const req = new Request('http://localhost/api/cron/link-health', {
      method: 'POST',
      headers: { 'x-origin-verify': 'test-secret' },
    })

    const response = await POST(req)
    expect(response.status).toBe(200)
    expect(runLinkHealthCheck).toHaveBeenCalledOnce()

    const body = await response.json()
    expect(body).toMatchObject({ checked: 5, ok: 4, broken: 1 })
  })

  it('returns 500 when runLinkHealthCheck throws', async () => {
    vi.mocked(runLinkHealthCheck).mockRejectedValue(new Error('DB unavailable'))

    const { POST } = await import('../route')
    const req = new Request('http://localhost/api/cron/link-health', {
      method: 'POST',
      headers: { 'x-origin-verify': 'test-secret' },
    })

    const response = await POST(req)
    expect(response.status).toBe(500)
  })
})
