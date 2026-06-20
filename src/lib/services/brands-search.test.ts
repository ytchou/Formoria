import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Supabase service client
const mockRpc = vi.fn()
const mockSupabase = {
  rpc: mockRpc,
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => mockSupabase,
}))

// Import after mock
const { searchBrands } = await import('@/lib/services/brands')

describe('searchBrands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls search_brands RPC with correct parameters', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: '123',
          name: 'Test Brand',
          slug: 'test-brand',
          primary_category_name: 'Food',
          similarity_score: 0.8,
        },
      ],
      error: null,
    })

    const results = await searchBrands('test', 5)

    expect(mockRpc).toHaveBeenCalledWith('search_brands', {
      search_query: 'test',
      result_limit: 5,
    })
    expect(results).toEqual([
      {
        id: '123',
        name: 'Test Brand',
        slug: 'test-brand',
        category: 'Food',
        similarity: 0.8,
      },
    ])
  })

  it('returns empty array on RPC error', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'something broke' },
    })

    const results = await searchBrands('test', 5)
    expect(results).toEqual([])
  })

  it('sanitizes search query (trims, caps at 100 chars)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    await searchBrands('  hello  ', 5)

    expect(mockRpc).toHaveBeenCalledWith('search_brands', {
      search_query: 'hello',
      result_limit: 5,
    })
  })

  it('returns empty array for empty query', async () => {
    const results = await searchBrands('', 5)
    expect(mockRpc).not.toHaveBeenCalled()
    expect(results).toEqual([])
  })
})
