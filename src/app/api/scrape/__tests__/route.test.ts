import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()

vi.mock('@/lib/services/scraper', () => ({
  scrapeBrandUrls: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: mockGetUser,
      },
    })
  ),
}))

import { POST } from '../route'
import { scrapeBrandUrls } from '@/lib/services/scraper'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/scrape', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/scrape', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
    })
  })

  it('returns scraped data for valid URL', async () => {
    const mockData = {
      brandName: 'Test Brand',
      description: 'A test brand',
      story: null,
      heroImageUrl: null,
      galleryImageUrls: [],
      socialLinks: { instagram: null, threads: null, facebook: null },
      categoryHints: [],
      websiteUrl: 'https://test.com',
      rawJsonLd: null,
    }
    const mockStatuses = [
      { url: 'https://a.com', ok: true, classification: 'official-site' as const },
    ]
    vi.mocked(scrapeBrandUrls).mockResolvedValue({
      data: mockData,
      statuses: mockStatuses,
    })

    const response = await POST(makeRequest({ urls: ['https://a.com'] }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.data).toEqual(mockData)
    expect(json.statuses).toEqual(mockStatuses)
  })

  it('returns 400 for invalid URL', async () => {
    const response = await POST(makeRequest({ urls: ['nope'] }))
    expect(response.status).toBe(400)
  })

  it('returns 401 for unauthenticated request', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
    })

    const response = await POST(makeRequest({ urls: ['https://test.com'] }))
    expect(response.status).toBe(401)
  })
})
