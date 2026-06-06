// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockSendGAEvent = vi.fn()
vi.mock('@next/third-parties/google', () => ({
  sendGAEvent: (...args: unknown[]) => mockSendGAEvent(...args),
}))

import { mapPurchaseDestination, trackDbClick } from '../analytics'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('analytics DB click tracking', () => {
  it('trackDbClick POSTs a click with normalized destination, fire-and-forget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    trackDbClick('b1', 'instagram')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/analytics/track',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        body: JSON.stringify({
          brandId: 'b1',
          event: 'click',
          destination: 'instagram',
        }),
      })
    )
  })

  it('mapPurchaseDestination lowercases and sanitizes platform', () => {
    expect(mapPurchaseDestination('Shopee 蝦皮')).toBe('shopee')
  })
})
