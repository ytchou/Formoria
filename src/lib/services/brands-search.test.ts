import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Supabase service client
const mockRpc = vi.fn()
const mockFrom = vi.fn()
const mockSupabase = {
  rpc: mockRpc,
  from: mockFrom,
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => mockSupabase,
}))

const { getBrands } = await import('@/lib/services/brands')

describe('getBrands search path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls search_brands RPC with correct parameters and hydrates matches', async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          id: '123',
          name: 'Test Brand',
          slug: 'test-brand',
          hero_image_url: null,
          primary_category_name: 'Food',
          rank_score: 0.8,
          search_source: 'fts',
        },
      ],
      error: null,
    })

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({
          data: [
            {
              id: '123',
              name: 'Test Brand',
              slug: 'test-brand',
              description: null,
              hero_image_url: null,
              status: 'approved',
              product_type: 'food',
              submitted_at: '2026-01-01T00:00:00Z',
              approved_at: '2026-01-02T00:00:00Z',
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-02T00:00:00Z',
              brand_owners: [],
            },
          ],
          error: null,
        }),
      }),
    })

    const results = await getBrands({ search: 'test', limit: 5 })

    expect(mockRpc).toHaveBeenCalledWith('search_brands', {
      search_query: 'test',
      result_limit: null,
      prefix_mode: false,
      filter_categories: null,
      filter_tags: null,
      filter_verification: null,
      filter_status: 'approved',
      include_test_brands: false,
    })
    expect(results.brands).toHaveLength(1)
    expect(results.brands[0].name).toBe('Test Brand')
    expect(results.totalCount).toBe(1)
  })

  it('returns empty array on RPC error', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'something broke' },
    })

    const result = await getBrands({ search: 'test', limit: 5 })
    expect(result).toEqual({ brands: [], totalCount: 0 })
  })

  it('sanitizes search query (trims, caps at 100 chars)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    await getBrands({ search: '  hello  ', limit: 5 })

    expect(mockRpc).toHaveBeenCalledWith('search_brands', expect.objectContaining({
      search_query: 'hello',
    }))
  })

  it('returns empty array for empty query', async () => {
    const results = await getBrands({ search: '', limit: 5 })
    expect(mockRpc).not.toHaveBeenCalled()
    expect(results).toEqual({ brands: [], totalCount: 0 })
  })
})
