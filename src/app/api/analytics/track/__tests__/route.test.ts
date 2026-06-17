import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'

vi.mock('@/lib/services/brand-analytics', () => ({
  incrementView: vi.fn().mockResolvedValue(undefined),
  incrementClick: vi.fn().mockResolvedValue(undefined),
  incrementLinkClick: vi.fn().mockResolvedValue(undefined),
}))

import { incrementView, incrementClick, incrementLinkClick } from '@/lib/services/brand-analytics'

function makeRequest(body: object, ip = '127.0.0.1') {
  return new Request('http://localhost/api/analytics/track', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': ip,
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

  it('click with valid destination calls incrementLinkClick', async () => {
    const res = await POST(
      makeRequest({ brandId: 'brand-click-destination', event: 'click', destination: 'shopee' })
    )
    expect(res.status).toBe(204)
    expect(incrementClick).toHaveBeenCalledWith('brand-click-destination')
    expect(incrementLinkClick).toHaveBeenCalledWith('brand-click-destination', 'shopee')
  })

  it('click with invalid destination still counts the total, skips per-link', async () => {
    const res = await POST(
      makeRequest({
        brandId: 'brand-click-invalid-destination',
        event: 'click',
        destination: 'BAD DEST!!',
      })
    )
    expect(res.status).toBe(204)
    expect(incrementClick).toHaveBeenCalledWith('brand-click-invalid-destination')
    expect(incrementLinkClick).not.toHaveBeenCalled()
  })

  it('click without destination is unchanged (back-compat)', async () => {
    const res = await POST(makeRequest({ brandId: 'brand-click-no-destination', event: 'click' }))
    expect(res.status).toBe(204)
    expect(incrementClick).toHaveBeenCalledWith('brand-click-no-destination')
    expect(incrementLinkClick).not.toHaveBeenCalled()
  })

  it('different destinations are not mutually rate-limited', async () => {
    await POST(
      makeRequest(
        { brandId: 'brand-click-rate-limit-destination', event: 'click', destination: 'shopee' },
        '1.1.1.1'
      )
    )
    await POST(
      makeRequest(
        {
          brandId: 'brand-click-rate-limit-destination',
          event: 'click',
          destination: 'instagram',
        },
        '1.1.1.1'
      )
    )
    expect(incrementLinkClick).toHaveBeenCalledTimes(2)
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
