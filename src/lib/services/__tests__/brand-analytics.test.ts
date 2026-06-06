import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  incrementView,
  incrementClick,
  getAnalytics,
  getDailySeries,
  getLinkClickBreakdown,
  incrementLinkClick,
} from '../brand-analytics'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase/server'

type BrandAnalyticsSeedRow = {
  date: string
  views: number
  clicks: number
}

type BrandLinkClickSeedRow = {
  date: string
  destination: string
  clicks: number
}

type MockAnalyticsRow = BrandAnalyticsSeedRow & {
  brand_id: string
}

type MockLinkClickRow = BrandLinkClickSeedRow & {
  brand_id: string
}

type MockState = {
  brandAnalytics: MockAnalyticsRow[]
  brandLinkClicks: MockLinkClickRow[]
  rpcError: unknown | null
  queryError: unknown | null
}

let mockState: MockState
let brandCounter = 0
const seededBrandIds = new Set<string>()

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function today(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return formatLocalDate(date)
}

function seedBrand(): string {
  brandCounter += 1
  const brandId = `00000000-0000-0000-0000-${`${brandCounter}`.padStart(12, '0')}`
  seededBrandIds.add(brandId)
  return brandId
}

async function seedBrandWithAnalytics(rows: BrandAnalyticsSeedRow[]): Promise<string> {
  const brandId = seedBrand()
  const client = createServiceClient()
  await client.from('brand_analytics').insert(
    rows.map((row) => ({
      brand_id: brandId,
      date: row.date,
      views: row.views,
      clicks: row.clicks,
    }))
  )
  return brandId
}

async function seedBrandWithLinkClicks(rows: BrandLinkClickSeedRow[]): Promise<string> {
  const brandId = seedBrand()
  const client = createServiceClient()
  await client.from('brand_link_clicks').insert(
    rows.map((row) => ({
      brand_id: brandId,
      date: row.date,
      destination: row.destination,
      clicks: row.clicks,
    }))
  )
  return brandId
}

function makeSupabaseClient({
  brandAnalytics = [],
  brandLinkClicks = [],
  rpcError = null,
  queryError = null,
}: Partial<MockState> = {}) {
  mockState = {
    brandAnalytics: [...brandAnalytics],
    brandLinkClicks: [...brandLinkClicks],
    rpcError,
    queryError,
  }

  const makeQueryBuilder = (table: 'brand_analytics' | 'brand_link_clicks') => {
    const filters: Array<{ type: 'eq' | 'gte'; column: string; value: string }> = []
    let orderBy: { column: string; ascending: boolean } | null = null

    const execute = () => {
      if (mockState.queryError) {
        return { data: null, error: mockState.queryError }
      }

      const source = table === 'brand_analytics' ? mockState.brandAnalytics : mockState.brandLinkClicks
      const data = [...source]
        .filter((row) =>
          filters.every((filter) => {
            const rowValue = row[filter.column as keyof typeof row]
            if (filter.type === 'eq') {
              return rowValue === filter.value
            }
            return typeof rowValue === 'string' && rowValue >= filter.value
          })
        )
        .sort((left, right) => {
          if (!orderBy) return 0
          const leftValue = left[orderBy.column as keyof typeof left]
          const rightValue = right[orderBy.column as keyof typeof right]
          if (leftValue === rightValue) return 0
          if (orderBy.ascending) {
            return leftValue < rightValue ? -1 : 1
          }
          return leftValue > rightValue ? -1 : 1
        })

      return { data, error: null }
    }

    const insert = async (value: Record<string, unknown> | Array<Record<string, unknown>>) => {
      const rows = Array.isArray(value) ? value : [value]

      if (table === 'brand_analytics') {
        mockState.brandAnalytics.push(...(rows as MockAnalyticsRow[]))
      } else {
        mockState.brandLinkClicks.push(...(rows as MockLinkClickRow[]))
      }

      return { data: rows, error: null }
    }

    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: string) => {
        filters.push({ type: 'eq', column, value })
        return builder
      }),
      gte: vi.fn((column: string, value: string) => {
        filters.push({ type: 'gte', column, value })
        return builder
      }),
      order: vi.fn((column: string, options?: { ascending?: boolean }) => {
        orderBy = { column, ascending: options?.ascending ?? true }
        return builder
      }),
      insert: vi.fn(insert),
      then: (resolve: (value: ReturnType<typeof execute>) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(execute()).then(resolve, reject),
    }

    return builder
  }

  const client = {
    rpc: vi.fn(async (fn: string, params?: { p_brand_id?: string; p_destination?: string }) => {
      if (mockState.rpcError) {
        return { error: mockState.rpcError }
      }

      if (fn === 'increment_brand_link_click') {
        const brandId = params?.p_brand_id ?? ''
        const destination = params?.p_destination ?? ''

        if (!isUuid(brandId)) {
          return { error: { message: 'invalid input syntax for type uuid' } }
        }

        const existingRow = mockState.brandLinkClicks.find(
          (row) => row.brand_id === brandId && row.date === today(0) && row.destination === destination
        )

        if (existingRow) {
          existingRow.clicks += 1
        } else {
          mockState.brandLinkClicks.push({
            brand_id: brandId,
            date: today(0),
            destination,
            clicks: 1,
          })
        }
      }

      return { error: null }
    }),
    from: vi.fn((table: 'brand_analytics' | 'brand_link_clicks') => makeQueryBuilder(table)),
  }

  vi.mocked(createServiceClient).mockReturnValue(client as unknown as ReturnType<typeof createServiceClient>)
  return client
}

beforeEach(() => {
  brandCounter = 0
  seededBrandIds.clear()
  vi.clearAllMocks()
  makeSupabaseClient()
})

afterEach(() => {
  seededBrandIds.clear()
  vi.useRealTimers()
})

describe('incrementView', () => {
  it('calls rpc increment_brand_view with the brand id', async () => {
    const client = makeSupabaseClient()
    await incrementView('brand-1')
    expect(client.rpc).toHaveBeenCalledWith('increment_brand_view', { p_brand_id: 'brand-1' })
  })

  it('does not throw on supabase error', async () => {
    makeSupabaseClient({ rpcError: { message: 'DB error' } })
    await expect(incrementView('brand-1')).resolves.not.toThrow()
  })
})

describe('incrementClick', () => {
  it('calls rpc increment_brand_click with the brand id', async () => {
    const client = makeSupabaseClient()
    await incrementClick('brand-1')
    expect(client.rpc).toHaveBeenCalledWith('increment_brand_click', { p_brand_id: 'brand-1' })
  })
})

describe('getAnalytics', () => {
  // Freeze the clock so the fixed row dates below stay inside the 30-day
  // window regardless of when the suite runs (otherwise the test is a
  // time-bomb that fails once today is >30 days past the row dates).
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns totals and trend data for 30 days', async () => {
    const rows = [
      { brand_id: 'brand-1', date: '2026-05-01', views: 10, clicks: 2 },
      { brand_id: 'brand-1', date: '2026-05-15', views: 20, clicks: 5 },
    ]
    makeSupabaseClient({ brandAnalytics: rows })
    const result = await getAnalytics('brand-1', 30)
    expect(result.totalViews).toBe(30)
    expect(result.totalClicks).toBe(7)
  })

  it('returns zeros when no data exists', async () => {
    makeSupabaseClient()
    const result = await getAnalytics('brand-1', 30)
    expect(result.totalViews).toBe(0)
    expect(result.totalClicks).toBe(0)
    expect(result.viewTrend).toBe('flat')
    expect(result.clickTrend).toBe('flat')
  })
})

describe('getDailySeries', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T12:00:00'))
  })

  it('returns ascending, gap-filled daily points', async () => {
    const brandId = await seedBrandWithAnalytics([
      { date: today(-2), views: 5, clicks: 1 },
      { date: today(0), views: 3, clicks: 2 },
    ])

    const series = await getDailySeries(brandId, 3)

    expect(series.map((point) => point.date)).toEqual([today(-2), today(-1), today(0)])
    expect(series[1]).toMatchObject({ views: 0, clicks: 0 })
    expect(series[2]).toMatchObject({ views: 3, clicks: 2 })
  })
})

describe('getLinkClickBreakdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T12:00:00'))
  })

  it('sums per destination and sorts descending', async () => {
    const brandId = await seedBrandWithLinkClicks([
      { date: today(0), destination: 'shopee', clicks: 4 },
      { date: today(-1), destination: 'shopee', clicks: 2 },
      { date: today(0), destination: 'instagram', clicks: 3 },
    ])

    const rows = await getLinkClickBreakdown(brandId, 7)

    expect(rows).toEqual([
      { destination: 'shopee', clicks: 6 },
      { destination: 'instagram', clicks: 3 },
    ])
  })
})

describe('incrementLinkClick', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-20T12:00:00'))
  })

  it('upserts a per-destination row', async () => {
    const brandId = seedBrand()

    await incrementLinkClick(brandId, 'instagram')
    await incrementLinkClick(brandId, 'instagram')

    const rows = await getLinkClickBreakdown(brandId, 1)

    expect(rows).toEqual([{ destination: 'instagram', clicks: 2 }])
  })

  it('never throws on RPC error (silent-fail)', async () => {
    await expect(incrementLinkClick('not-a-uuid', 'x')).resolves.toBeUndefined()
  })
})
