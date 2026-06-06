import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'

vi.mock('@/lib/services/brand-analytics', () => ({
  incrementView: vi.fn().mockResolvedValue(undefined),
  incrementClick: vi.fn().mockResolvedValue(undefined),
}))

import { incrementView, incrementClick } from '@/lib/services/brand-analytics'

function makeRequest(body: object, ip = '127.0.0.1') {
  return new Request('http://localhost/api/analytics/track', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/analytics/track', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 204 and calls incrementView for view events', async () => {
    const res = await POST(makeRequest({ brandId: 'brand-1', event: 'view' }, '127.0.0.1'))
    expect(res.status).toBe(204)
    expect(incrementView).toHaveBeenCalledWith('brand-1', 'direct')
    expect(incrementClick).not.toHaveBeenCalled()
  })

  it('returns 204 and calls incrementClick for click events', async () => {
    const res = await POST(makeRequest({ brandId: 'brand-1', event: 'click' }))
    expect(res.status).toBe(204)
    expect(incrementClick).toHaveBeenCalledWith('brand-1')
  })

  it('returns 400 for missing brandId', async () => {
    const res = await POST(makeRequest({ event: 'view' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid event type', async () => {
    const res = await POST(makeRequest({ brandId: 'brand-1', event: 'share' }))
    expect(res.status).toBe(400)
  })

  it('forwards a valid source to incrementView', async () => {
    const res = await POST(
      makeRequest({ brandId: 'brand-1', event: 'view', source: 'category' }, '127.0.0.2')
    )
    expect(res.status).toBe(204)
    expect(incrementView).toHaveBeenCalledWith('brand-1', 'category')
  })

  it('coerces an invalid source to direct', async () => {
    await POST(makeRequest({ brandId: 'brand-1', event: 'view', source: 'garbage' }, '127.0.0.3'))
    expect(incrementView).toHaveBeenCalledWith('brand-1', 'direct')
  })

  it('defaults a missing source to direct', async () => {
    await POST(makeRequest({ brandId: 'brand-1', event: 'view' }, '127.0.0.4'))
    expect(incrementView).toHaveBeenCalledWith('brand-1', 'direct')
  })

  it('returns 204 even when incrementView throws', async () => {
    vi.mocked(incrementView).mockRejectedValueOnce(new Error('DB error'))
    const res = await POST(makeRequest({ brandId: 'brand-1', event: 'view' }, '127.0.0.5'))
    expect(res.status).toBe(204)
  })
})
