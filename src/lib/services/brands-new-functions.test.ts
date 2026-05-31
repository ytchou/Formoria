import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase service client
vi.mock('@/lib/supabase/server')

// Mock taxonomy service for getBrandStats
vi.mock('@/lib/services/taxonomy', () => ({
  getActiveCategories: vi.fn().mockResolvedValue([
    { slug: 'food', name: 'Food', nameZh: '食品' },
    { slug: 'beauty', name: 'Beauty', nameZh: '美妝' },
    { slug: 'design', name: 'Design', nameZh: '設計' },
  ]),
}))

import { createServiceClient } from '@/lib/supabase/server'
import { getRandomBrands, getNewBrands, getBrandStats } from './brands'

const mockBrandRows = [
  {
    id: '1', name: '茶籽堂', slug: 'cha-zi-tang', description: '苦茶籽品牌',
    category: 'beauty', hero_image_url: null, logo_url: null, website: 'https://example.com',
    status: 'approved', founding_year: 2004, approved_at: '2026-01-15T00:00:00Z',
    submitted_at: '2026-01-01T00:00:00Z',
    social_links: {}, brand_taxonomy: [], brand_owners: [],
    created_at: '2026-01-01', updated_at: '2026-01-01',
    purchase_links: [], retail_locations: [], product_photos: [],
    contact_email: null, brand_highlights: null,
  },
  {
    id: '2', name: '春一枝', slug: 'chun-yi-zhi', description: '天然水果冰棒',
    category: 'food', hero_image_url: null, logo_url: null, website: null,
    status: 'approved', founding_year: 2008, approved_at: '2026-02-20T00:00:00Z',
    submitted_at: '2026-01-02T00:00:00Z',
    social_links: {}, brand_taxonomy: [], brand_owners: [],
    created_at: '2026-01-02', updated_at: '2026-01-02',
    purchase_links: [], retail_locations: [], product_photos: [],
    contact_email: null, brand_highlights: null,
  },
  {
    id: '3', name: '印花樂', slug: 'inblooom', description: '台灣花布設計',
    category: 'design', hero_image_url: null, logo_url: null, website: null,
    status: 'approved', founding_year: 2008, approved_at: '2026-03-10T00:00:00Z',
    submitted_at: '2026-01-03T00:00:00Z',
    social_links: {}, brand_taxonomy: [], brand_owners: [],
    created_at: '2026-01-03', updated_at: '2026-01-03',
    purchase_links: [], retail_locations: [], product_photos: [],
    contact_email: null, brand_highlights: null,
  },
]

function createMockChain(data: unknown[] | null, options?: { count?: number; error?: unknown }) {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'is', 'neq', 'order', 'limit', 'single', 'maybeSingle']
  methods.forEach((m) => {
    chain[m] = vi.fn(() => chain)
  })
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({
      data,
      error: options?.error ?? null,
      count: options?.count ?? (data?.length ?? 0),
    }).then(resolve)
  return chain
}

describe('getRandomBrands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns at most `limit` approved brands', async () => {
    const chain = createMockChain(mockBrandRows)
    vi.mocked(createServiceClient).mockReturnValue({ from: vi.fn(() => chain) } as unknown as ReturnType<typeof createServiceClient>)

    const result = await getRandomBrands(2)

    expect(result).toHaveLength(2)
    result.forEach((brand) => {
      expect(brand).toHaveProperty('id')
      expect(brand).toHaveProperty('name')
      expect(brand).toHaveProperty('slug')
    })
  })

  it('returns empty array when no brands exist', async () => {
    const chain = createMockChain([])
    vi.mocked(createServiceClient).mockReturnValue({ from: vi.fn(() => chain) } as unknown as ReturnType<typeof createServiceClient>)

    const result = await getRandomBrands(4)

    expect(result).toEqual([])
  })

  it('returns all brands when fewer than limit exist', async () => {
    const chain = createMockChain(mockBrandRows.slice(0, 1))
    vi.mocked(createServiceClient).mockReturnValue({ from: vi.fn(() => chain) } as unknown as ReturnType<typeof createServiceClient>)

    const result = await getRandomBrands(4)

    expect(result).toHaveLength(1)
  })
})

describe('getNewBrands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns brands and queries with approved_at descending', async () => {
    const chain = createMockChain(mockBrandRows.slice(0, 2))
    vi.mocked(createServiceClient).mockReturnValue({ from: vi.fn(() => chain) } as unknown as ReturnType<typeof createServiceClient>)

    const result = await getNewBrands(2)

    expect(result).toHaveLength(2)
    expect(chain.order).toHaveBeenCalledWith('approved_at', { ascending: false })
    expect(chain.limit).toHaveBeenCalled()
  })

  it('returns empty array when no brands exist', async () => {
    const chain = createMockChain([])
    vi.mocked(createServiceClient).mockReturnValue({ from: vi.fn(() => chain) } as unknown as ReturnType<typeof createServiceClient>)

    const result = await getNewBrands(4)

    expect(result).toEqual([])
  })
})

describe('getBrandStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns brandCount and categoryCount', async () => {
    const chain = createMockChain(null, { count: 42 })
    vi.mocked(createServiceClient).mockReturnValue({ from: vi.fn(() => chain) } as unknown as ReturnType<typeof createServiceClient>)

    const stats = await getBrandStats()

    expect(stats).toHaveProperty('brandCount')
    expect(stats).toHaveProperty('categoryCount')
    expect(typeof stats.brandCount).toBe('number')
    expect(typeof stats.categoryCount).toBe('number')
    expect(stats.brandCount).toBe(42)
    expect(stats.categoryCount).toBe(3)
  })
})
