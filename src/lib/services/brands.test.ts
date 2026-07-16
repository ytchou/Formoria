import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  BRAND_SELECT,
  brandToDomain,
  brandToInsert,
  generateSlug,
  extractLatinRun,
  deleteBrand,
} from './brands'
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

  it('converts CJK names to Wade-Giles (not Hanyu Pinyin)', () => {
    expect(generateSlug('鼎泰豐')).toBe('ting-tai-feng')
  })

  it('converts 遇合 to Wade-Giles', () => {
    expect(generateSlug('遇合')).toBe('yu-ho')
  })

  it('converts 廣源良 to Wade-Giles', () => {
    expect(generateSlug('廣源良')).toBe('kuang-yuan-liang')
  })

  it('uses WG hsin for pinyin xin', () => {
    expect(generateSlug('新光')).toBe('hsin-kuang')
  })
})

describe('extractLatinRun', () => {
  it('extracts Latin substring from mixed-script name', () => {
    expect(extractLatinRun('愛麗絲傢俱 iliz')).toBe('iliz')
  })

  it('returns null for CJK-only name', () => {
    expect(extractLatinRun('遇合')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractLatinRun('')).toBeNull()
  })

  it('returns the full name if already Latin', () => {
    expect(extractLatinRun('SunnyHills')).toBe('SunnyHills')
  })

  it('extracts longest Latin run', () => {
    expect(extractLatinRun('台灣 Good Cho 好丘')).toBe('Good Cho')
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
      status: 'approved' as const,
      category: 'food',
      founding_year: 2020,
      social_instagram: '@test',
      purchase_website: 'https://test.com',
      purchase_shopee: 'https://shopee.tw/test',
      retail_locations: [],
      contact_email: 'test@example.com',
      submitted_at: '2026-01-01T00:00:00Z',
      approved_at: '2026-01-02T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    }

    const brand = brandToDomain(dbRow)

    expect(brand.id).toBe('123')
    expect(brand.heroImageUrl).toBeNull()
    expect(brand.foundingYear).toBe(2020)
    expect(brand.purchaseShopee).toBe('https://shopee.tw/test')
    expect(brand.purchaseWebsite).toBe('https://test.com')
    expect(brand.socialInstagram).toBe('@test')
    expect(brand.productPhotos).toEqual([])
    expect(brand.contactEmail).toBe('test@example.com')
    expect(brand.submittedAt).toBe('2026-01-01T00:00:00Z')
    expect(brand.approvedAt).toBe('2026-01-02T00:00:00Z')
  })
})

describe('brand select rollout compatibility', () => {
  it('keeps migration-dependent romanized metadata out of general page queries', () => {
    expect(BRAND_SELECT).not.toContain('romanized_name')
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

describe('brandToDomain — basic fields', () => {
  const baseRow = {
    id: 'test-id', name: 'Test Brand', slug: 'test-brand',
    description: 'A test brand', hero_image_url: null,
    status: 'approved' as const, category: 'Food & Beverage', founding_year: 2004,
    retail_locations: [],
    contact_email: null,
    submitted_at: '2026-01-01T00:00:00Z', approved_at: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  }

  it('maps description', () => {
    const row = {
      ...baseRow,
      description: '介紹',
    }
    const brand = brandToDomain(row)
    expect(brand.description).toBe('介紹')
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

  it('filters the normal browse query by price range', async () => {
    const { getBrands } = await import('./brands')
    const resolvedData = { data: [], error: null, count: 0 }
    const chainable: Record<string, unknown> = {}
    const chainFn = vi.fn(() => chainable)
    chainable.select = chainFn
    chainable.in = chainFn
    chainable.not = chainFn
    chainable.eq = chainFn
    chainable.order = chainFn
    chainable.range = chainFn
    chainable.then = (resolve: (v: unknown) => void) => Promise.resolve(resolvedData).then(resolve)
    mockFrom.mockReturnValue(chainable)

    await getBrands({ priceRanges: [1, 3] })

    expect(chainFn).toHaveBeenCalledWith('price_range', [1, 3])
  })

  it('returns empty brands array (not throw) when offset exceeds search result count', async () => {
    // The search path uses in-memory slicing (not .range()), so PGRST103 cannot naturally
    // occur in hydration. This test verifies that out-of-bounds offset is handled gracefully.
    const { getBrands } = await import('./brands')

    // RPC returns 1 brand, but client requests offset=96 — well past the result count
    mockRpc.mockResolvedValue({
      data: [{
        id: 'brand-1',
        name: 'Test Brand',
        slug: 'test-brand',
        hero_image_url: null,
        primary_category_name: 'Food',
        rank_score: 0.9,
        search_source: 'fts',
      }],
      error: null,
    })

    const result = await getBrands({ search: 'tea', limit: 6, offset: 96 })

    // offset > totalCount → empty page, no hydration attempted
    expect(result.brands).toEqual([])
    expect(result.totalCount).toBe(1)
    // hydrateByIds was called with empty array → from() never called
    expect(mockFrom).not.toHaveBeenCalled()
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
      data: [{ id: 'brand-tea', name: 'Sun Tea', slug: 'sun-tea', primary_category_name: 'Food', rank_score: 0.8, search_source: 'trgm' }],
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
      contact_email: null,
      brand_owners: [],
      submitted_at: '2026-01-01T00:00:00Z',
      approved_at: '2026-01-02T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
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

describe('updateBrand romanized slug lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRpc.mockResolvedValue({ error: null })
  })

  it('sends romanized metadata and its available slug through one brand patch', async () => {
    const currentQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { slug: 'warmwood-living' },
        error: null,
      }),
    }
    const collisionQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const updatedQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'brand-1',
          name: 'Warmwood Living',
          slug: 'warmwood-home',
          romanized_name: 'Warmwood Home',
          status: 'approved',
          submitted_at: null,
          created_at: null,
          updated_at: null,
        },
        error: null,
      }),
    }
    mockFrom
      .mockReturnValueOnce(currentQuery)
      .mockReturnValueOnce(collisionQuery)
      .mockReturnValueOnce(updatedQuery)

    const { updateBrand } = await import('./brands')
    const result = await updateBrand('brand-1', {
      romanizedName: 'Warmwood Home',
    })

    expect(mockRpc).toHaveBeenCalledWith(
      'apply_brand_patch',
      expect.objectContaining({
        p_patch: expect.objectContaining({
          romanized_name: 'Warmwood Home',
          slug: 'warmwood-home',
        }),
      }),
    )
    expect(result.slug).toBe('warmwood-home')
  })

  it('clears romanized metadata without changing the existing slug', async () => {
    const currentQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { slug: 'warmwood-living' },
        error: null,
      }),
    }
    const updatedQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'brand-1',
          name: 'Warmwood Living',
          slug: 'warmwood-living',
          romanized_name: null,
          status: 'approved',
          submitted_at: null,
          created_at: null,
          updated_at: null,
        },
        error: null,
      }),
    }
    mockFrom.mockReturnValueOnce(currentQuery).mockReturnValueOnce(updatedQuery)

    const { updateBrand } = await import('./brands')
    await updateBrand('brand-1', { romanizedName: null })

    expect(mockRpc).toHaveBeenCalledWith(
      'apply_brand_patch',
      expect.objectContaining({
        p_patch: expect.not.objectContaining({ slug: expect.anything() }),
      }),
    )
  })

  it('re-resolves a concurrent slug collision before retrying the patch', async () => {
    const currentQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { slug: 'warmwood-living' },
        error: null,
      }),
    }
    const availableQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const takenQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: 'brand-2' },
        error: null,
      }),
    }
    const updatedQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'brand-1',
          name: 'Warmwood Living',
          slug: 'warmwood-home-2',
          romanized_name: 'Warmwood Home',
          status: 'approved',
          submitted_at: null,
          created_at: null,
          updated_at: null,
        },
        error: null,
      }),
    }
    mockFrom
      .mockReturnValueOnce(currentQuery)
      .mockReturnValueOnce(availableQuery)
      .mockReturnValueOnce(takenQuery)
      .mockReturnValueOnce(availableQuery)
      .mockReturnValueOnce(updatedQuery)
    mockRpc
      .mockResolvedValueOnce({ error: { code: '23505' } })
      .mockResolvedValueOnce({ error: null })

    const { updateBrand } = await import('./brands')
    await updateBrand('brand-1', { romanizedName: 'Warmwood Home' })

    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      'apply_brand_patch',
      expect.objectContaining({
        p_patch: expect.objectContaining({ slug: 'warmwood-home-2' }),
      }),
    )
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

  it('retries without romanized metadata while the brands migration is pending', async () => {
    const { getBrandBySlug } = await import('./brands')
    const missingColumnQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42703', message: 'column brands.romanized_name does not exist' },
      }),
    }
    const compatibleQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'brand-1',
          name: 'Warmwood Living',
          slug: 'warmwood-living',
          status: 'approved',
        },
        error: null,
      }),
    }
    const imageQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    mockFrom
      .mockReturnValueOnce(missingColumnQuery)
      .mockReturnValueOnce(compatibleQuery)
      .mockReturnValueOnce(imageQuery)

    const brand = await getBrandBySlug('warmwood-living', { includeRomanizedName: true })

    expect(brand.romanizedName).toBeNull()
    expect(missingColumnQuery.select).toHaveBeenCalledWith(
      expect.stringContaining('romanized_name'),
    )
    expect(compatibleQuery.select).toHaveBeenCalledWith(BRAND_SELECT)
  })

  it('updateBrand wraps original error as the NotFoundError cause', async () => {
    const { updateBrand } = await import('./brands')
    const supabaseError = { code: 'PGRST301', message: 'Database error' }
    // New updateBrand calls apply_brand_patch RPC first, then re-fetches the brand.
    // RPC succeeds; re-fetch fails with supabaseError → wrapped as NotFoundError.
    mockRpc.mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: supabaseError }),
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
