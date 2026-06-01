import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()

vi.mock('@/lib/services/scraper', () => ({
  scrapeBrandUrl: vi.fn(),
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
import { scrapeBrandUrl } from '@/lib/services/scraper'

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
    vi.mocked(scrapeBrandUrl).mockResolvedValue(mockData)

    const response = await POST(makeRequest({ url: 'https://test.com' }))
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.brandName).toBe('Test Brand')
  })

  it('returns 400 for invalid URL', async () => {
    const response = await POST(makeRequest({ url: 'not-a-url' }))
    expect(response.status).toBe(400)
  })

  it('returns 401 for unauthenticated request', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
    })

    const response = await POST(makeRequest({ url: 'https://test.com' }))
    expect(response.status).toBe(401)
  })
})
