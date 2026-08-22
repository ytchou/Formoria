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
  category: string | null
  brand_owners: Array<{ user_id: string }>
}

import type { createServiceClient } from '@/lib/supabase/service'
import {
  DIRECTORY_BRAND_COLUMN_LIST,
  DIRECTORY_OMITTED_COLUMNS,
  brandsBySlugsCacheKey,
  fetchBrandsBySlugKey,
  getBrandsBySlugs,
} from '../brands'

type QueryCall = {
  table: string
  select: string
  inColumn: string | null
  inValues: string[]
  eqFilters: Array<[string, string]>
}

type RedirectRowFixture = { old_slug: string; new_slug: string }

const queries: QueryCall[] = []
let table: BrandRowFixture[] = []
let redirectTable: RedirectRowFixture[] = []
let queryError: { message: string; code?: string; hint?: string } | null = null
let redirectError: { message: string } | null = null

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
            data: BrandRowFixture[] | RedirectRowFixture[] | null
            error: { message: string; code?: string; hint?: string } | null
          }) => unknown
        ) {
          // The redirect table is a different shape and has its own failure
          // mode, so it gets its own branch rather than being squeezed through
          // the brand-row filter below.
          if (call.table === 'brand_slug_redirects') {
            if (redirectError) {
              return Promise.resolve(resolve({ data: null, error: redirectError }))
            }
            const hops = redirectTable.filter(
              (row) => call.inColumn === null || call.inValues.includes(row.old_slug)
            )
            return Promise.resolve(resolve({ data: hops, error: null }))
          }
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

/**
 * Drives the injectable query the way `getBrandsBySlugs` does — same cache key
 * derivation, same client-shaped double. Mocking `@/lib/supabase/service` to
 * reach the same place is what `scripts/check-test-boundaries.mjs` forbids.
 */
function lookup(slugs: string[]) {
  return fetchBrandsBySlugKey(
    createClientDouble() as unknown as ReturnType<typeof createServiceClient>,
    brandsBySlugsCacheKey(slugs)
  )
}

function brandRow(overrides: Partial<BrandRowFixture> & { slug: string }): BrandRowFixture {
  return {
    id: `id-${overrides.slug}`,
    name: overrides.slug,
    status: 'approved',
    category: 'bags-accessories',
    brand_owners: [],
    ...overrides,
  }
}

describe('getBrandsBySlugs', () => {
  beforeEach(() => {
    queries.length = 0
    queryError = null
    redirectError = null
    redirectTable = []
    table = [
      brandRow({ slug: 'molasses', name: 'Molasses' }),
      brandRow({ slug: 'kiln-studio', name: 'Kiln Studio' }),
      brandRow({ slug: 'hidden-brand', name: 'Hidden Brand', status: 'hidden' }),
    ]
  })

  it('returns a Map keyed by slug for found approved brands', async () => {
    const result = await lookup(['molasses', 'kiln-studio'])

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
    await lookup(['molasses'])

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
    const result = await lookup(['molasses', 'does-not-exist'])

    expect(result.size).toBe(1)
    expect(result.has('molasses')).toBe(true)
    expect(result.has('does-not-exist')).toBe(false)
  })

  it('omits brands whose status is not approved', async () => {
    const result = await lookup(['hidden-brand', 'molasses'])

    expect(result.has('hidden-brand')).toBe(false)
    expect(result.has('molasses')).toBe(true)
  })

  it('returns an empty Map for an empty input array without querying', async () => {
    // The real entry point, not the injectable query: the early return is the
    // whole point — it never reaches a Supabase client at all, which is why
    // this one call is safe to make against the unmocked module.
    const result = await getBrandsBySlugs([])

    expect(result.size).toBe(0)
    expect(queries).toHaveLength(0)
  })

  it('deduplicates repeated slugs in the input', async () => {
    const result = await lookup(['molasses', 'molasses', 'kiln-studio'])

    expect(queries).toHaveLength(1)
    // The cache key sorts its slugs so the same set in a different order is one
    // cache entry rather than two identical round trips.
    expect(queries[0]?.inValues).toEqual(['kiln-studio', 'molasses'])
    expect(result.size).toBe(2)
  })

  /*
   * Renamed-slug recovery. On 2026-08-02 a batch refresh re-derived twelve
   * brand slugs from their names; the story MDX and the event lineup manifest
   * both pin brands by slug, so five cards silently became placeholders. The
   * redirect table already recorded every rename — these pin that the embedded
   * lookup now honours it.
   */
  describe('renamed slugs', () => {
    beforeEach(() => {
      table.push(brandRow({ slug: 'tan-nichi', name: '恬日 Tan.Nichi' }))
      redirectTable = [{ old_slug: 'nichi', new_slug: 'tan-nichi' }]
    })

    it('resolves a renamed brand under the slug the caller asked for', async () => {
      const result = await lookup(['molasses', 'nichi'])

      // Keyed by the authored slug, because that is what the caller holds.
      expect(result.get('nichi')?.name).toBe('恬日 Tan.Nichi')
      // ...but the Brand carries its CURRENT slug, so the rendered link points
      // at the canonical URL rather than bouncing through the redirect.
      expect(result.get('nichi')?.slug).toBe('tan-nichi')
      expect(result.get('molasses')?.name).toBe('Molasses')
    })

    it('costs no extra query when every slug resolves directly', async () => {
      await lookup(['molasses', 'kiln-studio'])

      // The recovery path must not tax the common case: one query, no redirect
      // lookup at all.
      expect(queries).toHaveLength(1)
      expect(queries.some((call) => call.table === 'brand_slug_redirects')).toBe(false)
    })

    it('still omits a slug that has no redirect either', async () => {
      const result = await lookup(['does-not-exist'])

      expect(result.has('does-not-exist')).toBe(false)
    })

    it('omits a redirect whose target brand is not approved', async () => {
      table.push(brandRow({ slug: 'now-hidden', name: 'Now Hidden', status: 'hidden' }))
      redirectTable = [{ old_slug: 'was-visible', new_slug: 'now-hidden' }]

      const result = await lookup(['was-visible'])

      // A rename must not become a back door around the status filter.
      expect(result.has('was-visible')).toBe(false)
    })

    it('degrades to a placeholder rather than throwing when the redirect lookup fails', async () => {
      // Asymmetric with the brand query on purpose: this path only runs for
      // slugs that already failed to resolve, so failing the whole render would
      // take down a page whose other cards are fine.
      redirectError = { message: 'connection reset' }
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await lookup(['molasses', 'nichi'])

      expect(result.has('nichi')).toBe(false)
      expect(result.get('molasses')?.name).toBe('Molasses')
      expect(consoleError).toHaveBeenCalled()
      consoleError.mockRestore()
    })
  })

  it('degrades to an empty Map when the query errors during a production build', async () => {
    // CI builds with no database reachable. The throw below protects ISR, where
    // a last good page exists to keep serving; during `next build` there is no
    // such page, so the same throw aborts the export and fails the build for
    // every story that embeds a brand card.
    queryError = { message: 'connect ECONNREFUSED 127.0.0.1:54321' }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const previousPhase = process.env.NEXT_PHASE
    process.env.NEXT_PHASE = 'phase-production-build'

    try {
      const result = await lookup(['molasses'])

      expect(result.size).toBe(0)
      expect(consoleError).toHaveBeenCalled()
    } finally {
      if (previousPhase === undefined) delete process.env.NEXT_PHASE
      else process.env.NEXT_PHASE = previousPhase
      consoleError.mockRestore()
    }
  })

  it('still throws during a build when STRICT_PRERENDER_DATA is set', async () => {
    // The escape hatch for deploy builds, which do have a database: opting in
    // turns the degradation back into a hard failure rather than shipping a
    // page of placeholder cards.
    queryError = { message: 'connect ECONNREFUSED 127.0.0.1:54321' }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const previousPhase = process.env.NEXT_PHASE
    const previousStrict = process.env.STRICT_PRERENDER_DATA
    process.env.NEXT_PHASE = 'phase-production-build'
    process.env.STRICT_PRERENDER_DATA = '1'
    vi.resetModules()

    try {
      const { fetchBrandsBySlugKey: strictFetch } = await import('../brands')
      await expect(
        strictFetch(
          createClientDouble() as unknown as ReturnType<typeof createServiceClient>,
          brandsBySlugsCacheKey(['kiln-studio'])
        )
      ).rejects.toThrow()
    } finally {
      if (previousPhase === undefined) delete process.env.NEXT_PHASE
      else process.env.NEXT_PHASE = previousPhase
      if (previousStrict === undefined) delete process.env.STRICT_PRERENDER_DATA
      else process.env.STRICT_PRERENDER_DATA = previousStrict
      vi.resetModules()
      consoleError.mockRestore()
    }
  })

  /*
   * What the thrown message carries. On 2026-08-21 the only thing that reached
   * Sentry was "column brands.product_type does not exist" — Postgres had put
   * the actionable fix in `hint`, and the throw dropped it. The console.error
   * beside the throw logs the whole object, but stdout is not where the alert
   * is read.
   */
  describe('the thrown message', () => {
    async function thrownMessage(): Promise<string> {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        await lookup(['molasses'])
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      } finally {
        consoleError.mockRestore()
      }
      throw new Error('expected the query error to throw')
    }

    it('includes the PostgREST code in the thrown message', async () => {
      queryError = { code: '42703', message: 'column brands.product_type does not exist' }

      expect(await thrownMessage()).toContain('42703')
    })

    it('includes the hint when Postgres supplies one', async () => {
      queryError = {
        code: '42703',
        message: 'column brands.product_type does not exist',
        hint: 'Perhaps you meant to reference the column "brands.product_types".',
      }

      expect(await thrownMessage()).toContain('brands.product_types')
    })

    it('still names the operation and the slug', async () => {
      queryError = { code: '42703', message: 'column brands.product_type does not exist' }

      // The prefix is what existing log greps match on, so the change stays additive.
      expect(await thrownMessage()).toContain('Failed to fetch brands by slug:')
    })

    it('degrades cleanly when code and hint are absent', async () => {
      queryError = { message: 'connection reset' }

      const message = await thrownMessage()

      expect(message).toBe('Failed to fetch brands by slug: connection reset')
      expect(message).not.toContain('undefined')
    })
  })

  it('throws when the query itself errors, so ISR keeps the last good page', async () => {
    // A missing slug and a broken database must not look the same. An absent slug
    // stays absent from the Map (covered above) and the story still renders; a real
    // query error has to propagate, or a transient outage during revalidation bakes
    // "brand unavailable" placeholders into the cached page for the full TTL.
    queryError = { message: 'connection reset' }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(lookup(['molasses'])).rejects.toThrow()

    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
