import { describe, it, expect, vi, beforeEach } from 'vitest'
import { brandToDomain, brandToInsert, generateSlug, deleteBrand } from './brands'
import { NotFoundError } from '@/lib/errors'
import { RESERVED_ROUTES } from '@/middleware'

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  })),
}))

vi.mock('next/server', () => {
  const NextResponse = {
    next: vi.fn(() => ({
      cookies: { set: vi.fn() },
    })),
  }
  return { NextResponse }
})

describe('generateSlug', () => {
  it('converts name to kebab-case', () => {
    expect(generateSlug('My Cool Brand')).toBe('my-cool-brand')
  })

  it('strips special characters', () => {
    expect(generateSlug('Brand & Co. (Taiwan)')).toBe('brand-co-taiwan')
  })

  it('collapses multiple hyphens', () => {
    expect(generateSlug('Brand -- Name')).toBe('brand-name')
  })

  it('trims leading/trailing hyphens', () => {
    expect(generateSlug(' -Brand- ')).toBe('brand')
  })
})

describe('deleteBrand', () => {
  it('should be an exported async function', () => {
    expect(typeof deleteBrand).toBe('function')
  })
})

describe('brandToDomain', () => {
  it('transforms snake_case DB row to camelCase Brand', () => {
    const dbRow = {
      id: '123',
      name: 'Test Brand',
      slug: 'test-brand',
      description: 'A test brand',
      hero_image_url: null,
      status: 'approved',
      category: 'food',
      founding_year: 2020,
      social_instagram: '@test',
      purchase_website: 'https://test.com',
      purchase_shopee: 'https://shopee.tw/test',
      retail_locations: [],
      product_photos: ['photo1.jpg'],
      contact_email: 'test@example.com',
      submitted_at: '2026-01-01T00:00:00Z',
      approved_at: '2026-01-02T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      brand_taxonomy: [
        { taxonomy_tags: { id: 'tag1', name: 'Food', name_zh: '食品', slug: 'food', category: 'product_type', is_active: true, suggested_by: null, created_at: '2026-01-01T00:00:00Z' } }
      ],
    }

    const brand = brandToDomain(dbRow)

    expect(brand.id).toBe('123')
    expect(brand.heroImageUrl).toBeNull()
    expect(brand.foundingYear).toBe(2020)
    expect(brand.purchaseShopee).toBe('https://shopee.tw/test')
    expect(brand.purchaseWebsite).toBe('https://test.com')
    expect(brand.socialInstagram).toBe('@test')
    expect(brand.productPhotos).toEqual(['photo1.jpg'])
    expect(brand.contactEmail).toBe('test@example.com')
    expect(brand.submittedAt).toBe('2026-01-01T00:00:00Z')
    expect(brand.approvedAt).toBe('2026-01-02T00:00:00Z')
    expect(brand.tags).toHaveLength(1)
    expect(brand.tags[0].name).toBe('Food')
    expect(brand.tags[0].nameZh).toBe('食品')
  })

  it('handles missing nested tags gracefully', () => {
    const dbRow = {
      id: '123', name: 'Test', slug: 'test', description: null,
      hero_image_url: null, status: 'pending',
      category: null, founding_year: null,
      retail_locations: [], product_photos: [],
      contact_email: null, submitted_at: '2026-01-01T00:00:00Z',
      approved_at: null, created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }

    const brand = brandToDomain(dbRow)
    expect(brand.tags).toEqual([])
  })
})

describe('brandToInsert', () => {
  it('transforms camelCase domain data to snake_case DB row', () => {
    const input = {
      name: 'New Brand',
      slug: 'new-brand',
      description: 'A new brand',
      category: 'food',
      purchaseWebsite: 'https://brand.com',
      socialInstagram: '@brand',
      contactEmail: 'brand@example.com',
    }

    const row = brandToInsert(input)

    expect(row.name).toBe('New Brand')
    expect(row.slug).toBe('new-brand')
    expect(row.purchase_website).toBe('https://brand.com')
    expect(row.social_instagram).toBe('@brand')
    expect(row.contact_email).toBe('brand@example.com')
    expect(row).not.toHaveProperty('purchaseWebsite')
  })
})

describe('brandToDomain — brandHighlights', () => {
  const baseRow = {
    id: 'test-id', name: 'Test Brand', slug: 'test-brand',
    description: 'A test brand', hero_image_url: null,
    status: 'approved', category: 'Food & Beverage', founding_year: 2004,
    retail_locations: [],
    product_photos: [], contact_email: null, brand_taxonomy: [],
    submitted_at: '2026-01-01T00:00:00Z', approved_at: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    brand_highlights: null,
  }

  it('brandToDomain ignores the dormant founder column', () => {
    const row = {
      ...baseRow,
      description: '介紹',
      founder: { name: 'X' },
    }
    const brand = brandToDomain(row)
    expect((brand as { founder?: unknown }).founder).toBeUndefined()
    expect(brand.description).toBe('介紹')
  })

  it('maps brand_highlights string to brandHighlights', () => {
    const row = { ...baseRow, brand_highlights: 'Handcrafted with Taiwanese cedar since 1992' }
    const brand = brandToDomain(row)
    expect(brand.brandHighlights).toBe('Handcrafted with Taiwanese cedar since 1992')
  })

  it('maps null brand_highlights to null', () => {
    const row = { ...baseRow, brand_highlights: null }
    const brand = brandToDomain(row)
    expect(brand.brandHighlights).toBeNull()
  })

})

describe('brandToInsert — brandHighlights', () => {
  it('brandToInsert does not write a founder field', () => {
    const input = {
      description: '介紹',
      brandHighlights: 'Eco-certified packaging',
    }
    const row = brandToInsert(input)
    expect('founder' in row).toBe(false)
    expect(row.description).toBe('介紹')
  })

  it('omits brand_highlights when brandHighlights is null', () => {
    const data = { brandHighlights: null }
    const row = brandToInsert(data)
    expect(row).not.toHaveProperty('brand_highlights')
  })
})

// ---------------------------------------------------------------------------
// getBrands — search via search_brands RPC (Task 2)
// ---------------------------------------------------------------------------

// Mock at top level to avoid hoisting issues
const mockRpc = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    rpc: mockRpc,
    from: mockFrom,
  })),
}))

// ---------------------------------------------------------------------------
// getBrands — PGRST103 offset overflow
// ---------------------------------------------------------------------------

describe('getBrands — PGRST103 offset overflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty brands array (not throw) when normal path gets PGRST103', async () => {
    const { getBrands } = await import('./brands')

    const pgrst103Error = { code: 'PGRST103', message: 'An offset of 96 was requested, but there are only 90 rows' }
    const resolvedData = { data: null, error: pgrst103Error, count: 90 }

    // Build a chainable mock where every method returns the same chainable object
    // and the terminal await resolves to the PGRST103 error response
    const chainable: Record<string, unknown> = {}
    const chainFn = () => chainable
    chainable.select = chainFn
    chainable.in = chainFn
    chainable.not = chainFn
    chainable.eq = chainFn
    chainable.overlaps = chainFn
    chainable.order = chainFn
    chainable.range = chainFn
    // Make it thenable so `await query` resolves to our error response
    chainable.then = (resolve: (v: unknown) => void) => Promise.resolve(resolvedData).then(resolve)

    mockFrom.mockReturnValue(chainable)

    const result = await getBrands({ limit: 6, offset: 96 })

    expect(result.brands).toEqual([])
    expect(result.totalCount).toBe(90)
  })

  it('returns empty brands array (not throw) when search path gets PGRST103', async () => {
    const { getBrands } = await import('./brands')

    const pgrst103Error = { code: 'PGRST103', message: 'An offset of 96 was requested, but there are only 90 rows' }
    const resolvedData = { data: null, error: pgrst103Error, count: 90 }

    // RPC returns matched IDs so we proceed to the pagination query
    mockRpc.mockResolvedValue({
      data: [{ id: 'brand-1' }],
      error: null,
    })

    // Build a chainable mock for the follow-up .from('brands') query
    const chainable: Record<string, unknown> = {}
    const chainFn = () => chainable
    chainable.select = vi.fn().mockReturnValue({ in: () => chainable })
    chainable.in = chainFn
    chainable.not = chainFn
    chainable.eq = chainFn
    chainable.overlaps = chainFn
    chainable.order = chainFn
    chainable.range = chainFn
    chainable.then = (resolve: (v: unknown) => void) => Promise.resolve(resolvedData).then(resolve)

    mockFrom.mockReturnValue(chainable)

    const result = await getBrands({ search: 'tea', limit: 6, offset: 96 })

    expect(result.brands).toEqual([])
    expect(result.totalCount).toBe(90)
  })

  it('still throws for non-PGRST103 errors in the normal path', async () => {
    const { getBrands } = await import('./brands')

    const otherError = { code: 'PGRST301', message: 'Some other database error' }
    const resolvedData = { data: null, error: otherError, count: null }

    const chainable: Record<string, unknown> = {}
    const chainFn = () => chainable
    chainable.select = chainFn
    chainable.in = chainFn
    chainable.not = chainFn
    chainable.eq = chainFn
    chainable.overlaps = chainFn
    chainable.order = chainFn
    chainable.range = chainFn
    chainable.then = (resolve: (v: unknown) => void) => Promise.resolve(resolvedData).then(resolve)

    mockFrom.mockReturnValue(chainable)

    await expect(getBrands({ limit: 6, offset: 10 })).rejects.toEqual(otherError)
  })
})

describe('getBrands — search uses search_brands RPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes a misspelling/partial term through RPC and returns matching brand', async () => {
    const { getBrands } = await import('./brands')

    // RPC returns a matched brand ID (simulate pg_trgm fuzzy match for "茶" partial)
    mockRpc.mockResolvedValue({
      data: [{ id: 'brand-tea', name: 'Sun Tea', slug: 'sun-tea', primary_category_name: 'Food', similarity_score: 0.8 }],
      error: null,
    })

    // Full brand row returned by the follow-up .from('brands').select().in() query
    const fakeBrandRow = {
      id: 'brand-tea',
      name: 'Sun Tea',
      slug: 'sun-tea',
      description: 'Premium loose-leaf tea from Nantou.',
      hero_image_url: null,
      status: 'approved',
      category: 'food',
      founding_year: 2010,
      purchase_links: [],
      social_links: {},
      retail_locations: [],
      product_photos: [],
      contact_email: null,
      brand_taxonomy: [],
      brand_owners: [],
      submitted_at: '2026-01-01T00:00:00Z',
      approved_at: '2026-01-02T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      brand_highlights: null,
      is_demo: false,
    }

    const resolvedData = { data: [fakeBrandRow], error: null, count: 1 }
    // When sort is 'random' (the new default), .order() is skipped, so each
    // terminal in the chain must be thenable (i.e. also a resolved promise).
    const mockEqResult = {
      order: vi.fn().mockResolvedValue(resolvedData),
      then: (resolve: (v: unknown) => void) => Promise.resolve(resolvedData).then(resolve),
    }
    const mockInChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnValue(mockEqResult),
      order: vi.fn().mockResolvedValue(resolvedData),
      then: (resolve: (v: unknown) => void) => Promise.resolve(resolvedData).then(resolve),
    }
    mockInChain.not = vi.fn(() => mockInChain)
    const mockIn = vi.fn().mockReturnValue(mockInChain)
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({ in: mockIn }),
    })

    const result = await getBrands({ search: 'sun te', status: 'approved' })

    // Verify RPC was called with the search query
    expect(mockRpc).toHaveBeenCalledWith('search_brands', expect.objectContaining({
      search_query: 'sun te',
    }))

    // Result should contain the matched brand
    expect(result.brands).toHaveLength(1)
    expect(result.brands[0].name).toBe('Sun Tea')
    expect(result.totalCount).toBe(1)
  })

  it('returns empty when RPC finds no matches', async () => {
    const { getBrands } = await import('./brands')

    mockRpc.mockResolvedValue({ data: [], error: null })

    const result = await getBrands({ search: 'xyznonexistent' })
    expect(result.brands).toEqual([])
    expect(result.totalCount).toBe(0)
    // from() should NOT be called — no IDs to query
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('returns empty and logs error when RPC fails', async () => {
    const { getBrands } = await import('./brands')

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRpc.mockResolvedValue({ data: null, error: new Error('RPC unavailable') })

    const result = await getBrands({ search: 'tea' })
    expect(result.brands).toEqual([])
    expect(result.totalCount).toBe(0)
    consoleSpy.mockRestore()
  })
})

describe('brand slug redirects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function mockOldSlugLookup(error: { code: string; message: string }) {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error }),
        }),
      }),
    })
  }

  it('findBrandByOldSlug returns null for PGRST116 errors', async () => {
    const { findBrandByOldSlug } = await import('./brands')
    const error = { code: 'PGRST116', message: 'No rows found' }
    mockOldSlugLookup(error)

    await expect(findBrandByOldSlug('old-slug')).resolves.toBeNull()
  })

  it('findBrandByOldSlug returns null for PGRST205 errors', async () => {
    const { findBrandByOldSlug } = await import('./brands')
    const error = { code: 'PGRST205', message: 'Schema cache stale' }
    mockOldSlugLookup(error)

    await expect(findBrandByOldSlug('old-slug')).resolves.toBeNull()
  })

  it('findBrandByOldSlug re-throws unknown PostgREST errors', async () => {
    const { findBrandByOldSlug } = await import('./brands')
    const error = { code: 'PGRST301', message: 'Unknown PostgREST error' }
    mockOldSlugLookup(error)

    await expect(findBrandByOldSlug('old-slug')).rejects.toEqual(error)
  })
})

describe('brand not found errors preserve Supabase cause', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function expectNotFoundCause(action: () => Promise<unknown>, cause: unknown) {
    try {
      await action()
      throw new Error('Expected action to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError)
      expect((error as Error).cause).toBe(cause)
    }
  }

  it('getBrandBySlug wraps original error as the NotFoundError cause', async () => {
    const { getBrandBySlug } = await import('./brands')
    const supabaseError = { code: 'PGRST301', message: 'Database error' }
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: supabaseError }),
        }),
      }),
    })

    await expectNotFoundCause(() => getBrandBySlug('missing-brand'), supabaseError)
  })

  it('updateBrand wraps original error as the NotFoundError cause', async () => {
    const { updateBrand } = await import('./brands')
    const supabaseError = { code: 'PGRST301', message: 'Database error' }
    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: supabaseError }),
          }),
        }),
      }),
    })

    await expectNotFoundCause(() => updateBrand('brand-1', { name: 'Updated Brand' }), supabaseError)
  })

  it('publishDraft wraps original error as the NotFoundError cause', async () => {
    const { publishDraft } = await import('./brands')
    const supabaseError = { code: 'PGRST301', message: 'Database error' }
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: supabaseError }),
        }),
      }),
    })

    await expectNotFoundCause(() => publishDraft('brand-1'), supabaseError)
  })

  it('getBrandById wraps original error as the NotFoundError cause', async () => {
    const { getBrandById } = await import('./brands')
    const supabaseError = { code: 'PGRST301', message: 'Database error' }
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: supabaseError }),
        }),
      }),
    })

    await expectNotFoundCause(() => getBrandById('brand-1'), supabaseError)
  })
})

describe('brand slug validation against reserved routes', () => {
  it('RESERVED_ROUTES set is available and non-empty', () => {
    expect(RESERVED_ROUTES.size).toBeGreaterThan(0)
  })

  it('generateSlug can produce reserved slugs that must be caught', () => {
    const slug = generateSlug('Admin')
    expect(slug).toBe('admin')
    expect(RESERVED_ROUTES.has(slug)).toBe(true)
  })

  it('normal brand names do not collide with reserved routes', () => {
    const slug = generateSlug('Cha Zi Tang')
    expect(RESERVED_ROUTES.has(slug)).toBe(false)
  })

  it('isReservedSlug returns true for reserved slugs', async () => {
    const { isReservedSlug } = await import('./brands')
    expect(isReservedSlug('admin')).toBe(true)
    expect(isReservedSlug('api')).toBe(true)
    expect(isReservedSlug('cha-zi-tang')).toBe(false)
  })
})
