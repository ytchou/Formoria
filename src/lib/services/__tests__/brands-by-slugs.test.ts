import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `getBrandsBySlugs` is the lookup editorial MDX shortcodes use. Unlike
 * `getBrandBySlug` it must never throw: story content references brands by
 * slug, and a renamed, hidden, or deleted brand has to degrade to a placeholder
 * card rather than take the whole story page down. These tests pin that
 * contract plus the batching (one query for N slugs) the grid depends on.
 */

type BrandRowFixture = {
  id: string
  name: string
  slug: string
  status: string
  product_type: string | null
  brand_owners: Array<{ user_id: string }>
}

const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/server')>()),
  createServiceClient: mocks.createServiceClient,
}))

import {
  DIRECTORY_BRAND_COLUMN_LIST,
  DIRECTORY_OMITTED_COLUMNS,
  getBrandsBySlugs,
} from '../brands'

type QueryCall = {
  table: string
  select: string
  inColumn: string | null
  inValues: string[]
  eqFilters: Array<[string, string]>
}

const queries: QueryCall[] = []
let table: BrandRowFixture[] = []
let queryError: { message: string } | null = null

/**
 * Minimal Supabase query-builder double that actually applies `.in()` and
 * `.eq()` to the fixture rows, so the `status = 'approved'` filter is exercised
 * rather than assumed.
 */
function createClientDouble() {
  return {
    from(tableName: string) {
      const call: QueryCall = {
        table: tableName,
        select: '',
        inColumn: null,
        inValues: [],
        eqFilters: [],
      }
      queries.push(call)

      const builder = {
        select(columns: string) {
          call.select = columns
          return builder
        },
        in(column: string, values: string[]) {
          call.inColumn = column
          call.inValues = values
          return builder
        },
        eq(column: string, value: unknown) {
          call.eqFilters.push([column, String(value)])
          return builder
        },
        then(
          resolve: (result: {
            data: BrandRowFixture[] | null
            error: { message: string } | null
          }) => unknown
        ) {
          if (queryError) {
            return Promise.resolve(resolve({ data: null, error: queryError }))
          }
          const rows = table.filter((row) => {
            const inMatch =
              call.inColumn === null ||
              call.inValues.includes(String(row[call.inColumn as keyof BrandRowFixture]))
            const eqMatch = call.eqFilters.every(
              ([column, value]) => String(row[column as keyof BrandRowFixture]) === value
            )
            return inMatch && eqMatch
          })
          return Promise.resolve(resolve({ data: rows, error: null }))
        },
      }

      return builder
    },
  }
}

function brandRow(overrides: Partial<BrandRowFixture> & { slug: string }): BrandRowFixture {
  return {
    id: `id-${overrides.slug}`,
    name: overrides.slug,
    status: 'approved',
    product_type: 'bags-accessories',
    brand_owners: [],
    ...overrides,
  }
}

describe('getBrandsBySlugs', () => {
  beforeEach(() => {
    queries.length = 0
    queryError = null
    table = [
      brandRow({ slug: 'molasses', name: 'Molasses' }),
      brandRow({ slug: 'kiln-studio', name: 'Kiln Studio' }),
      brandRow({ slug: 'hidden-brand', name: 'Hidden Brand', status: 'hidden' }),
    ]
    mocks.createServiceClient.mockReset()
    mocks.createServiceClient.mockImplementation(() => createClientDouble())
  })

  it('returns a Map keyed by slug for found approved brands', async () => {
    const result = await getBrandsBySlugs(['molasses', 'kiln-studio'])

    expect(result.size).toBe(2)
    expect(result.get('molasses')?.name).toBe('Molasses')
    expect(result.get('kiln-studio')?.name).toBe('Kiln Studio')
    expect(queries[0]?.table).toBe('brands')
    expect(queries[0]?.inColumn).toBe('slug')
    expect(queries[0]?.eqFilters).toContainEqual(['status', 'approved'])
  })

  it('requests the narrow directory projection, not the full brand row', async () => {
    // Story pages render many editorial cards, and every column in the
    // projection is serialized into the RSC payload once per card. The four
    // `DIRECTORY_OMITTED_COLUMNS` are large jsonb blobs the card never renders
    // — and `draft_data` is unpublished editorial content that must not reach
    // the client at all. Asserted here rather than left to a reviewer's grep,
    // so widening the projection fails a test instead of passing review.
    await getBrandsBySlugs(['molasses'])

    const select = queries[0]?.select ?? ''
    const selected = select.split(',').map((column) => column.trim())

    for (const column of DIRECTORY_BRAND_COLUMN_LIST) {
      expect(selected, `expected ${column} in the directory projection`).toContain(column)
    }
    for (const column of DIRECTORY_OMITTED_COLUMNS) {
      expect(selected, `${column} must stay out of card queries`).not.toContain(column)
    }
    expect(selected).toContain('brand_owners(user_id)')
  })

  it('omits slugs with no matching brand instead of throwing', async () => {
    const result = await getBrandsBySlugs(['molasses', 'does-not-exist'])

    expect(result.size).toBe(1)
    expect(result.has('molasses')).toBe(true)
    expect(result.has('does-not-exist')).toBe(false)
  })

  it('omits brands whose status is not approved', async () => {
    const result = await getBrandsBySlugs(['hidden-brand', 'molasses'])

    expect(result.has('hidden-brand')).toBe(false)
    expect(result.has('molasses')).toBe(true)
  })

  it('returns an empty Map for an empty input array without querying', async () => {
    const result = await getBrandsBySlugs([])

    expect(result.size).toBe(0)
    expect(mocks.createServiceClient).not.toHaveBeenCalled()
    expect(queries).toHaveLength(0)
  })

  it('deduplicates repeated slugs in the input', async () => {
    const result = await getBrandsBySlugs(['molasses', 'molasses', 'kiln-studio'])

    expect(queries).toHaveLength(1)
    // The cache key sorts its slugs so the same set in a different order is one
    // cache entry rather than two identical round trips.
    expect(queries[0]?.inValues).toEqual(['kiln-studio', 'molasses'])
    expect(result.size).toBe(2)
  })

  it('throws when the query itself errors, so ISR keeps the last good page', async () => {
    // A missing slug and a broken database must not look the same. An absent slug
    // stays absent from the Map (covered above) and the story still renders; a real
    // query error has to propagate, or a transient outage during revalidation bakes
    // "brand unavailable" placeholders into the cached page for the full TTL.
    queryError = { message: 'connection reset' }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(getBrandsBySlugs(['molasses'])).rejects.toThrow()

    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
