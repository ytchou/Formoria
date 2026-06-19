import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSearchBrands = vi.fn()

vi.mock('@/lib/services/brands', () => ({
  searchBrands: mockSearchBrands,
}))

const { GET } = await import('./route')

function makeRequest(url: string) {
  return new Request(url)
}

describe('GET /api/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns search results with cache headers', async () => {
    mockSearchBrands.mockResolvedValue([
      {
        id: '1',
        name: 'Tea Brand',
        slug: 'tea-brand',
        category: 'Food',
        similarity: 0.9,
      },
    ])

    const response = await GET(makeRequest('http://localhost/api/search?q=tea'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300'
    )
    expect(body.results).toHaveLength(1)
    expect(body.results[0].name).toBe('Tea Brand')
    expect(mockSearchBrands).toHaveBeenCalledWith('tea', 5)
  })

  it('returns 400 when q param is missing', async () => {
    const response = await GET(makeRequest('http://localhost/api/search'))
    expect(response.status).toBe(400)
  })

  it('returns 400 when q param is empty', async () => {
    const response = await GET(makeRequest('http://localhost/api/search?q='))
    expect(response.status).toBe(400)
  })

  it('respects custom limit param', async () => {
    mockSearchBrands.mockResolvedValue([])

    await GET(makeRequest('http://localhost/api/search?q=tea&limit=3'))

    expect(mockSearchBrands).toHaveBeenCalledWith('tea', 3)
  })

  it('caps limit at 10', async () => {
    mockSearchBrands.mockResolvedValue([])

    await GET(makeRequest('http://localhost/api/search?q=tea&limit=50'))

    expect(mockSearchBrands).toHaveBeenCalledWith('tea', 10)
  })

  it('returns empty results on service error', async () => {
    mockSearchBrands.mockRejectedValue(new Error('DB down'))

    const response = await GET(makeRequest('http://localhost/api/search?q=tea'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.results).toEqual([])
  })
})
