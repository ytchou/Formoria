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

const { getBrands, searchBrandsAutocomplete } = await import('@/lib/services/brands')

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

  it('caps a full-search query at 100 characters before the RPC', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    await getBrands({ search: `  ${'台'.repeat(101)}  `, limit: 5 })

    expect(mockRpc).toHaveBeenCalledWith(
      'search_brands',
      expect.objectContaining({ search_query: '台'.repeat(100) }),
    )
  })

  it('returns empty array for empty query', async () => {
    const results = await getBrands({ search: '', limit: 5 })
    expect(mockRpc).not.toHaveBeenCalled()
    expect(results).toEqual({ brands: [], totalCount: 0 })
  })

  it('preserves RPC relevance order for the default random sort', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-19T00:00:00Z'))
    mockRpc.mockResolvedValue({
      data: [
        {
          id: 'exact',
          name: 'Exact Name',
          slug: 'exact-name',
          primary_category_name: 'crafts',
          rank_score: 1,
          search_source: 'fts',
        },
        {
          id: 'description',
          name: 'Description Match',
          slug: 'description-match',
          primary_category_name: 'crafts',
          rank_score: 0.1,
          search_source: 'fts',
        },
      ],
      error: null,
    })
    const rows = [
      {
        id: 'description',
        name: 'Description Match',
        slug: 'description-match',
        status: 'approved',
        product_type: 'crafts',
        retail_locations: [],
        brand_owners: [],
      },
      {
        id: 'exact',
        name: 'Exact Name',
        slug: 'exact-name',
        status: 'approved',
        product_type: 'crafts',
        retail_locations: [],
        brand_owners: [],
      },
    ]
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        in: vi.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    })

    try {
      const result = await getBrands({ search: 'exact', sort: 'random' })
      expect(result.brands.map((brand) => brand.id)).toEqual([
        'exact',
        'description',
      ])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('searchBrandsAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses prefix mode and maps the RPC result to the public shape', async () => {
    mockRpc.mockResolvedValue({
      data: [{
        id: 'brand-1',
        name: '台灣茶器',
        slug: 'taiwan-teaware',
        primary_category_name: 'crafts',
        rank_score: 0.9,
        search_source: 'fts',
      }],
      error: null,
    })

    await expect(searchBrandsAutocomplete('台 茶 & ware', 7)).resolves.toEqual([
      {
        id: 'brand-1',
        name: '台灣茶器',
        slug: 'taiwan-teaware',
        category: 'crafts',
      },
    ])
    expect(mockRpc).toHaveBeenCalledWith('search_brands', {
      search_query: '台 茶 & ware',
      prefix_mode: true,
      result_limit: 7,
    })
  })

  it('defaults to five results and surfaces RPC failures', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null })
    await searchBrandsAutocomplete('tea')
    expect(mockRpc).toHaveBeenLastCalledWith('search_brands', {
      search_query: 'tea',
      prefix_mode: true,
      result_limit: 5,
    })

    const rpcError = { message: 'search RPC unavailable' }
    mockRpc.mockResolvedValueOnce({ data: null, error: rpcError })
    await expect(searchBrandsAutocomplete('tea')).rejects.toBe(rpcError)
  })
})
