// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { BrandAnalyticsTracker } from '../brand-analytics-tracker'

describe('BrandAnalyticsTracker', () => {
  afterEach(() => vi.restoreAllMocks())

  it('fires a POST to /api/analytics/track with event=view on mount', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', mockFetch)

    render(<BrandAnalyticsTracker brandId="brand-1" />)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/analytics/track',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ brandId: 'brand-1', event: 'view' }),
        })
      )
    })
  })
})
