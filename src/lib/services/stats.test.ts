import { describe, it, expect, vi, beforeEach } from 'vitest'

// Neutralise React's cache so each test call re-executes the implementation
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, cache: <T extends (...args: unknown[]) => unknown>(fn: T): T => fn }
})

// --- Supabase mock ---
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ from: mockFrom }),
}))

const { getCityCoverage, getStatsPageData } = await import('./stats')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ChainOpts = {
  totalCount?: number
  mitCount?: number
  categories?: Array<{ product_type: string }>
  cities?: Array<{ city: string }>
  foundingYears?: Array<{ founding_year: number }>
}

/**
 * Build 5 independent Supabase query-chain mocks that match the 5 parallel
 * calls in getStatsPageDataImpl (in Promise.all order):
 *   Q1: from('brands').select('*', head).eq('status','approved')          → { count }
 *   Q2: from('brands').select('product_type').eq(...).not(...)            → { data }
 *   Q3: from('brands').select('city').eq(...).not(...)                    → { data }
 *   Q4: from('brands').select('*', head).eq('status','approved').eq(...)  → { count }
 *   Q5: from('brands').select('founding_year').eq(...).not(...)           → { data }
 */
function makeMockChains({
  totalCount = 10,
  mitCount = 5,
  categories = [
    { product_type: 'fashion' },
    { product_type: 'fashion' },
    { product_type: 'food' },
  ],
  cities = [
    { city: 'Taipei' },
    { city: 'Taipei' },
    { city: 'Taichung' },
  ],
  foundingYears = [
    { founding_year: 1985 },
    { founding_year: 1990 },
    { founding_year: 2005 },
  ],
}: ChainOpts = {}) {
  // Q1: .select('*', head).eq('status', 'approved')
  const q1Eq = vi.fn().mockResolvedValue({ count: totalCount })
  const q1Select = vi.fn().mockReturnValue({ eq: q1Eq })

  // Q2: .select('product_type').eq(...).not(...)
  const q2Not = vi.fn().mockResolvedValue({ data: categories })
  const q2Eq = vi.fn().mockReturnValue({ not: q2Not })
  const q2Select = vi.fn().mockReturnValue({ eq: q2Eq })

  // Q3: .select('*', head).eq('status', 'approved').eq('mit_status', 'verified')
  const q3EqMit = vi.fn().mockResolvedValue({ count: mitCount })
  const q3EqStatus = vi.fn().mockReturnValue({ eq: q3EqMit })
  const q3Select = vi.fn().mockReturnValue({ eq: q3EqStatus })

  // Q4: .select('founding_year').eq(...).not(...)
  const q4Not = vi.fn().mockResolvedValue({ data: foundingYears })
  const q4Eq = vi.fn().mockReturnValue({ not: q4Not })
  const q4Select = vi.fn().mockReturnValue({ eq: q4Eq })

  // Q5: .select('city').eq(...).not(...)
  const q5Not = vi.fn().mockResolvedValue({ data: cities })
  const q5Eq = vi.fn().mockReturnValue({ not: q5Not })
  const q5Select = vi.fn().mockReturnValue({ eq: q5Eq })

  // Order matches Promise.all in getStatsPageDataImpl: total, categories, cities, mit, founding
  return [
    { select: q1Select },
    { select: q2Select },
    { select: q5Select },
    { select: q3Select },
    { select: q4Select },
  ]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getStatsPageData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const chains = makeMockChains()
    mockFrom
      .mockReturnValueOnce(chains[0])
      .mockReturnValueOnce(chains[1])
      .mockReturnValueOnce(chains[2])
      .mockReturnValueOnce(chains[3])
      .mockReturnValueOnce(chains[4])
  })

  it('returns all stats dimensions with correct shape', async () => {
    const data = await getStatsPageData()

    expect(typeof data.totalBrands).toBe('number')
    expect(data.totalBrands).toBeGreaterThanOrEqual(0)

    expect(Array.isArray(data.categoryBreakdown)).toBe(true)
    for (const cat of data.categoryBreakdown) {
      expect(cat).toHaveProperty('category')
      expect(cat).toHaveProperty('slug')
      expect(typeof cat.count).toBe('number')
    }

    expect(typeof data.mitVerifiedShare.verified).toBe('number')
    expect(typeof data.mitVerifiedShare.total).toBe('number')
    expect(typeof data.mitVerifiedShare.percentage).toBe('number')
    expect(data.mitVerifiedShare.percentage).toBeGreaterThanOrEqual(0)
    expect(data.mitVerifiedShare.percentage).toBeLessThanOrEqual(100)

    expect(Array.isArray(data.foundingDecadeDistribution)).toBe(true)
    for (const dec of data.foundingDecadeDistribution) {
      expect(dec).toHaveProperty('decade')
      expect(typeof dec.count).toBe('number')
    }
  })

  it('aggregates category counts correctly', async () => {
    const data = await getStatsPageData()
    // Seed has 2x fashion, 1x food → fashion count = 2, food count = 1
    expect(data.categoryBreakdown[0].count).toBe(2)
    expect(data.categoryBreakdown[1].count).toBe(1)
  })

  it('MIT verified percentage is computed correctly', async () => {
    const data = await getStatsPageData()
    // 5 verified out of 10 total = 50%
    expect(data.mitVerifiedShare.verified).toBe(5)
    expect(data.mitVerifiedShare.total).toBe(10)
    expect(data.mitVerifiedShare.percentage).toBe(50)
  })

  it('founding decade distribution is sorted chronologically', async () => {
    const data = await getStatsPageData()
    // Founding years: 1985 → 1980s, 1990 → 1990s, 2005 → 2000s
    expect(data.foundingDecadeDistribution[0].decade).toBe('1980s')
    expect(data.foundingDecadeDistribution[1].decade).toBe('1990s')
    expect(data.foundingDecadeDistribution[2].decade).toBe('2000s')
  })

  it('category breakdown is sorted by count descending', async () => {
    const data = await getStatsPageData()
    for (let i = 1; i < data.categoryBreakdown.length; i++) {
      expect(data.categoryBreakdown[i - 1].count).toBeGreaterThanOrEqual(
        data.categoryBreakdown[i].count
      )
    }
  })
})

describe('getCityCoverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const chains = makeMockChains()
    mockFrom.mockReturnValueOnce(chains[2])
  })

  it('returns an array', async () => {
    const data = await getCityCoverage()
    expect(Array.isArray(data)).toBe(true)
  })

  it('each entry has city (string) and count (number)', async () => {
    const data = await getCityCoverage()
    for (const entry of data) {
      expect(typeof entry.city).toBe('string')
      expect(typeof entry.count).toBe('number')
      expect(entry.count).toBeGreaterThan(0)
    }
  })

  it('results are ordered by count descending', async () => {
    const data = await getCityCoverage()
    for (let i = 1; i < data.length; i++) {
      expect(data[i].count).toBeLessThanOrEqual(data[i - 1].count)
    }
  })
})
