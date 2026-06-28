import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSearchBrandsAutocomplete = vi.fn()

vi.mock('@/lib/services/brands', () => ({
  searchBrandsAutocomplete: mockSearchBrandsAutocomplete,
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
    mockSearchBrandsAutocomplete.mockResolvedValue([
      {
        id: '1',
        name: 'Tea Brand',
        slug: 'tea-brand',
        category: 'Food',
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
    expect(mockSearchBrandsAutocomplete).toHaveBeenCalledWith('tea', 5)
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
    mockSearchBrandsAutocomplete.mockResolvedValue([])

    await GET(makeRequest('http://localhost/api/search?q=tea&limit=3'))

    expect(mockSearchBrandsAutocomplete).toHaveBeenCalledWith('tea', 3)
  })

  it('caps limit at 10', async () => {
    mockSearchBrandsAutocomplete.mockResolvedValue([])

    await GET(makeRequest('http://localhost/api/search?q=tea&limit=50'))

    expect(mockSearchBrandsAutocomplete).toHaveBeenCalledWith('tea', 10)
  })

  it('returns empty results on service error', async () => {
    mockSearchBrandsAutocomplete.mockRejectedValue(new Error('DB down'))

    const response = await GET(makeRequest('http://localhost/api/search?q=tea'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.results).toEqual([])
  })
})
