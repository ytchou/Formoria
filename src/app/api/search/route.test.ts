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

  it('returns 400 when q contains only whitespace', async () => {
    const response = await GET(makeRequest('http://localhost/api/search?q=%20%20%20'))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: "Query parameter 'q' is required and must be 1-100 characters",
    })
    expect(mockSearchBrandsAutocomplete).not.toHaveBeenCalled()
  })

  it('accepts exactly 100 characters and rejects 101 characters', async () => {
    mockSearchBrandsAutocomplete.mockResolvedValue([])
    const accepted = 'a'.repeat(100)
    const rejected = 'a'.repeat(101)

    const acceptedResponse = await GET(
      makeRequest(`http://localhost/api/search?q=${accepted}`),
    )
    const rejectedResponse = await GET(
      makeRequest(`http://localhost/api/search?q=${rejected}`),
    )

    expect(acceptedResponse.status).toBe(200)
    expect(rejectedResponse.status).toBe(400)
    expect(mockSearchBrandsAutocomplete).toHaveBeenCalledTimes(1)
    expect(mockSearchBrandsAutocomplete).toHaveBeenCalledWith(accepted, 5)
  })

  it('passes Unicode and reserved characters to the service unchanged', async () => {
    mockSearchBrandsAutocomplete.mockResolvedValue([])
    const query = '台 灣茶 & coffee/器物?'

    await GET(
      makeRequest(
        `http://localhost/api/search?q=${encodeURIComponent(query)}`,
      ),
    )

    expect(mockSearchBrandsAutocomplete).toHaveBeenCalledWith(query, 5)
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

  it.each([
    ['missing', '', 5],
    ['invalid', '&limit=invalid', 5],
    ['negative', '&limit=-4', 1],
    ['zero', '&limit=0', 5],
    ['over limit', '&limit=999', 10],
  ])('normalizes a %s limit', async (_label, suffix, expected) => {
    mockSearchBrandsAutocomplete.mockResolvedValue([])

    await GET(makeRequest(`http://localhost/api/search?q=tea${suffix}`))

    expect(mockSearchBrandsAutocomplete).toHaveBeenCalledWith('tea', expected)
  })

  it('returns 503 with stable error shape on service failure', async () => {
    mockSearchBrandsAutocomplete.mockRejectedValue(new Error('connection refused'))

    const response = await GET(makeRequest('http://localhost/api/search?q=tea'))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({ error: 'search_unavailable' })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('includes Server-Timing header on successful response', async () => {
    mockSearchBrandsAutocomplete.mockResolvedValue([])

    const response = await GET(makeRequest('http://localhost/api/search?q=tea'))

    expect(response.headers.get('Server-Timing')).toMatch(/^rpc;dur=\d/)
  })

  it('includes Server-Timing header on error response', async () => {
    mockSearchBrandsAutocomplete.mockRejectedValue(new Error('timeout'))

    const response = await GET(makeRequest('http://localhost/api/search?q=tea'))

    expect(response.headers.get('Server-Timing')).toMatch(/^rpc;dur=\d/)
  })
})
