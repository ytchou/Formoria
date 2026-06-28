import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRpc = vi.fn()
const mockCreateClient = vi.fn().mockResolvedValue({ rpc: mockRpc })

vi.mock('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}))

const { GET } = await import('./route')

function makeRequest(url: string) {
  return new Request(url)
}

describe('GET /api/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateClient.mockResolvedValue({ rpc: mockRpc })
  })

  it('returns search results with cache headers', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: '1',
          name: 'Tea Brand',
          slug: 'tea-brand',
          primary_category_name: 'Food',
          rank_score: 0.9,
        },
      ],
      error: null,
    })

    const response = await GET(makeRequest('http://localhost/api/search?q=tea'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300'
    )
    expect(body.results).toHaveLength(1)
    expect(body.results[0].name).toBe('Tea Brand')
    expect(mockRpc).toHaveBeenCalledWith('search_brands', {
      search_query: 'tea',
      result_limit: 5,
      prefix_mode: true,
    })
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
    mockRpc.mockResolvedValue({ data: [], error: null })

    await GET(makeRequest('http://localhost/api/search?q=tea&limit=3'))

    expect(mockRpc).toHaveBeenCalledWith('search_brands', {
      search_query: 'tea',
      result_limit: 3,
      prefix_mode: true,
    })
  })

  it('caps limit at 10', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    await GET(makeRequest('http://localhost/api/search?q=tea&limit=50'))

    expect(mockRpc).toHaveBeenCalledWith('search_brands', {
      search_query: 'tea',
      result_limit: 10,
      prefix_mode: true,
    })
  })

  it('returns empty results on service error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB down' } })

    const response = await GET(makeRequest('http://localhost/api/search?q=tea'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.results).toEqual([])
  })
})
