// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { BrandAnalyticsTracker } from '../brand-analytics-tracker'

vi.mock('@/lib/analytics/source-bucket', () => ({
  bucketSource: vi.fn(),
}))

import { bucketSource } from '@/lib/analytics/source-bucket'
const mockedBucketSource = vi.mocked(bucketSource)

describe('BrandAnalyticsTracker', () => {
  beforeEach(() => window.history.replaceState({}, '', '/brands/test'))
  afterEach(() => vi.restoreAllMocks())

  it('fires a POST to /api/analytics/track with event=view on mount', async () => {
    mockedBucketSource.mockReturnValue('direct')
    const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', mockFetch)

    render(<BrandAnalyticsTracker brandId="brand-1" />)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/analytics/track',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ brandId: 'brand-1', event: 'view', source: 'direct' }),
        })
      )
    })
  })

  it('sends the computed source bucket in the view POST', async () => {
    mockedBucketSource.mockReturnValue('external_search')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<BrandAnalyticsTracker brandId="brand-2" />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body).toMatchObject({ brandId: 'brand-2', event: 'view', source: 'external_search' })
  })

  it('uses the in-app source query parameter when provided', async () => {
    mockedBucketSource.mockReturnValue('category')
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    window.history.replaceState({}, '', '/brands/test?source=category')
    render(<BrandAnalyticsTracker brandId="brand-3" />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.source).toBe('category')
    expect(mockedBucketSource).toHaveBeenCalledWith('category', expect.any(String), expect.any(String))
  })
})
