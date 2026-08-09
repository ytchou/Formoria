import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `hydrateCardImageMeta` is what puts per-image metadata on every card surface —
 * /brands, the homepage, /favorites, story galleries and microsites all route
 * through it. It decides fill mode (`isLogo`) and `object-position`
 * (`focalX`/`focalY`), so a wrong row here is a visibly wrong crop rather than a
 * missing string.
 *
 * The load-bearing parts are the batching and the failure mode, and both are
 * invisible on a five-brand happy path:
 *   - chunking, because the `.in()` filters travel in the GET query string;
 *   - the inner `.range()` pager, because a chunk can exceed the row cap;
 *   - degrading instead of throwing, because the metadata is decorative and
 *     because `focal_x` does not exist between a deploy and its migration.
 */

import type { createServiceClient } from '@/lib/supabase/service'
import { BRAND_IMAGE_PAGE_SIZE } from '../_shared/brand-image-batch'
import { hydrateCardImageMeta } from '../brands'

type ImageRowFixture = {
  brand_id: string
  url: string
  tags: string[] | null
  alt_zh: string | null
  alt_en: string | null
  sort_order: number
  width: number | null
  height: number | null
  focal_x: number | null
  focal_y: number | null
}

type QueryCall = {
  table: string
  select: string
  /** Each `.in()` applied, in order — brand_id first, then url when narrowed. */
  inFilters: Array<[string, string[]]>
  eqFilters: Array<[string, string]>
  orders: string[]
  ranges: Array<[number, number]>
}

const queries: QueryCall[] = []
let table: ImageRowFixture[] = []
let queryError: { message: string; code?: string } | null = null

/**
 * Minimal Supabase query-builder double that really applies `.in()`, `.eq()`,
 * `.order()` and `.range()` to the fixture rows, so the chunker and the pager
 * are exercised rather than assumed. Mocking `@/lib/supabase/service` to reach
 * the same place is what `scripts/check-test-boundaries.mjs` forbids.
 */
function createClientDouble() {
  return {
    from(tableName: string) {
      const call: QueryCall = {
        table: tableName,
        select: '',
        inFilters: [],
        eqFilters: [],
        orders: [],
        ranges: [],
      }
      queries.push(call)

      const builder = {
        select(columns: string) {
          call.select = columns
          return builder
        },
        in(column: string, values: string[]) {
          call.inFilters.push([column, values])
          return builder
        },
        eq(column: string, value: unknown) {
          call.eqFilters.push([column, String(value)])
          return builder
        },
        order(column: string) {
          call.orders.push(column)
          return builder
        },
        range(from: number, to: number) {
          call.ranges.push([from, to])
          if (queryError) {
            return Promise.resolve({ data: null, error: queryError })
          }
          const matched = table
            .filter((row) =>
              call.inFilters.every(([column, values]) =>
                values.includes(String(row[column as 'brand_id' | 'url'])),
              ),
            )
            // Every fixture row stands for an active one, so `.eq('status', …)`
            // is recorded for assertion rather than applied.
            // The real query orders by (brand_id, sort_order, id); replicate the
            // first two, which is what makes paging stable and lets the caller
            // treat the first URL match as the lowest-sort_order one.
            .sort(
              (a, b) =>
                a.brand_id.localeCompare(b.brand_id) || a.sort_order - b.sort_order,
            )
          return Promise.resolve({
            data: matched.slice(from, to + 1),
            error: null,
          })
        },
      }

      return builder
    },
  }
}

function client() {
  return createClientDouble() as unknown as ReturnType<typeof createServiceClient>
}

function imageRow(overrides: Partial<ImageRowFixture> & { brand_id: string; url: string }): ImageRowFixture {
  return {
    tags: ['product'],
    alt_zh: null,
    alt_en: null,
    sort_order: 0,
    width: 1200,
    height: 900,
    focal_x: null,
    focal_y: null,
    ...overrides,
  }
}

function brand(id: string, heroImageUrl: string | null) {
  return { id, heroImageUrl }
}

describe('hydrateCardImageMeta', () => {
  beforeEach(() => {
    queries.length = 0
    queryError = null
    table = []
  })

  it('matches the hero row on url, not on sort_order', async () => {
    // `hero_image_url` is a denormalized copy of whichever row the brand leads
    // with, and a row can be rejected or reordered without that copy moving —
    // so position is not a reliable key while the url is. Here the hero sits at
    // sort_order 2, behind two other active rows.
    table = [
      imageRow({ brand_id: 'b1', url: 'https://x.supabase.co/other-a.webp', sort_order: 0 }),
      imageRow({ brand_id: 'b1', url: 'https://x.supabase.co/other-b.webp', sort_order: 1 }),
      imageRow({
        brand_id: 'b1',
        url: 'https://x.supabase.co/hero.webp',
        sort_order: 2,
        tags: ['logo'],
        alt_zh: '標誌',
        alt_en: 'Logo',
        focal_x: 0.25,
        focal_y: 0.75,
        width: 800,
        height: 800,
      }),
    ]

    const [hydrated] = await hydrateCardImageMeta(client(), [
      brand('b1', 'https://x.supabase.co/hero.webp'),
    ])

    expect(hydrated?.imageAlts).toEqual([
      { altZh: '標誌', altEn: 'Logo', isLogo: true, focalX: 0.25, focalY: 0.75 },
    ])
    expect(hydrated?.heroImageMetadata).toEqual({
      altZh: '標誌',
      altEn: 'Logo',
      width: 800,
      height: 800,
    })
  })

  it('leaves a brand with no active rows on the unhydrated defaults', async () => {
    // Not an error: a hero that predates `brand_images`, or whose row was
    // rejected, degrades to the uncarved centred `object-cover` render.
    const [hydrated] = await hydrateCardImageMeta(client(), [
      brand('missing', 'https://x.supabase.co/gone.webp'),
    ])

    expect(hydrated?.imageAlts).toEqual([])
    expect(hydrated?.heroImageMetadata).toBeNull()
  })

  it('leaves a brand whose hero url matches no row on the defaults', async () => {
    // The brand HAS active images; none of them is the denormalized hero. The
    // distinction matters: silently taking `sort_order` 0 instead would frame
    // the card from a different image's metadata.
    table = [
      imageRow({ brand_id: 'b1', url: 'https://x.supabase.co/gallery.webp', tags: ['logo'] }),
    ]

    const [hydrated] = await hydrateCardImageMeta(client(), [
      brand('b1', 'https://x.supabase.co/hero-that-moved.webp'),
    ])

    expect(hydrated?.imageAlts).toEqual([])
    expect(hydrated?.heroImageMetadata).toBeNull()
  })

  it('never queries for a brand with no hero url at all', async () => {
    const hydrated = await hydrateCardImageMeta(client(), [brand('b1', null)])

    expect(hydrated[0]?.imageAlts).toEqual([])
    expect(queries).toHaveLength(0)
  })

  it('returns an empty array for an empty input without querying', async () => {
    expect(await hydrateCardImageMeta(client(), [])).toEqual([])
    expect(queries).toHaveLength(0)
  })

  describe('chunking', () => {
    it('splits a large brand set across several requests and hydrates every one', async () => {
      // 400 brands with realistic-length storage URLs. The url `.in()` filter
      // travels in the query string, so this must NOT arrive as one request —
      // the whole reason the chunker exists.
      const brands = Array.from({ length: 400 }, (_, i) => {
        const id = `brand-${String(i).padStart(4, '0')}`
        const url = `https://xkcayngbttpxyibgzern.supabase.co/storage/v1/object/public/brand-images/brands/${id}/00000000-0000-0000-0000-0000000000${String(i).padStart(2, '0')}.webp`
        return brand(id, url)
      })
      table = brands.map((b) =>
        imageRow({ brand_id: b.id, url: b.heroImageUrl!, tags: ['logo'] }),
      )

      const hydrated = await hydrateCardImageMeta(client(), brands)

      expect(queries.length).toBeGreaterThan(1)
      for (const call of queries) {
        const urls = call.inFilters.find(([column]) => column === 'url')?.[1] ?? []
        const ids = call.inFilters.find(([column]) => column === 'brand_id')?.[1] ?? []
        // Both limits respected: the character budget on urls, the count cap on ids.
        // The budget is 2,000 characters of URL, and a chunk is closed only
        // once the NEXT url would overflow it — so one long url of headroom,
        // plus separators, is expected.
        expect(urls.join(',').length).toBeLessThanOrEqual(2_500)
        expect(ids.length).toBeLessThanOrEqual(200)
      }
      // And nothing is lost at a chunk boundary.
      expect(hydrated).toHaveLength(400)
      expect(hydrated.every((b) => b.imageAlts[0]?.isLogo === true)).toBe(true)
    })

    it('deduplicates repeated brands rather than filtering them twice', async () => {
      table = [imageRow({ brand_id: 'b1', url: 'https://x.supabase.co/hero.webp' })]

      const hydrated = await hydrateCardImageMeta(client(), [
        brand('b1', 'https://x.supabase.co/hero.webp'),
        brand('b1', 'https://x.supabase.co/hero.webp'),
      ])

      expect(queries).toHaveLength(1)
      expect(queries[0]?.inFilters.find(([c]) => c === 'brand_id')?.[1]).toEqual(['b1'])
      // Both copies still come back hydrated — dedupe applies to the QUERY, not
      // to the result, which stays positionally aligned with the input.
      expect(hydrated).toHaveLength(2)
      expect(hydrated.every((b) => b.imageAlts.length === 1)).toBe(true)
    })
  })

  describe('inner pager', () => {
    it('hydrates every brand when the total row count exceeds one page', async () => {
      // Spans the page cap across chunks: a caller that stopped at
      // BRAND_IMAGE_PAGE_SIZE rows overall would silently drop the tail brands'
      // metadata, which renders as a wrongly-framed card rather than an error.
      const count = BRAND_IMAGE_PAGE_SIZE + 25
      const brands = Array.from({ length: count }, (_, i) =>
        brand(`b-${String(i).padStart(5, '0')}`, `https://x.supabase.co/h${i}.webp`),
      )
      table = brands.map((b) => imageRow({ brand_id: b.id, url: b.heroImageUrl!, tags: ['logo'] }))

      const hydrated = await hydrateCardImageMeta(client(), brands)

      expect(hydrated).toHaveLength(count)
      expect(hydrated.every((b) => b.imageAlts[0]?.isLogo === true)).toBe(true)
    })

    it('keeps paging a single batch until a short page arrives', async () => {
      // Forced onto one request by using short urls and few brands, then given
      // more rows than one page holds — so the `.range()` loop, not the
      // chunker, is what has to fetch the rest.
      const brands = [brand('b1', 'u1'), brand('b2', 'u2')]
      table = [
        ...Array.from({ length: BRAND_IMAGE_PAGE_SIZE }, (_, i) =>
          imageRow({ brand_id: 'b1', url: 'u1', sort_order: i }),
        ),
        imageRow({ brand_id: 'b2', url: 'u2', sort_order: 0, tags: ['logo'] }),
      ]

      const hydrated = await hydrateCardImageMeta(client(), brands)

      // One QueryCall per `.from()`, and the pager builds a FRESH builder per
      // page — required, because a PostgREST builder is single-use and reusing
      // one across `.range()` calls is a real bug. So one batch paging twice is
      // two entries carrying one range each, not one entry with two ranges.
      expect(queries).toHaveLength(2)
      expect(queries[0]?.ranges[0]).toEqual([0, BRAND_IMAGE_PAGE_SIZE - 1])
      expect(queries[1]?.ranges[0]).toEqual([
        BRAND_IMAGE_PAGE_SIZE,
        BRAND_IMAGE_PAGE_SIZE * 2 - 1,
      ])
      // Identical filters on both entries is what proves this is ONE batch
      // paging rather than TWO chunks — without it the test would still pass if
      // the chunker wrongly split these two brands into separate requests.
      expect(queries[0]?.inFilters).toEqual(queries[1]?.inFilters)
      // The row that only the second page could reach.
      expect(hydrated[1]?.imageAlts[0]?.isLogo).toBe(true)
    })

    it('orders before ranging, so pages cannot repeat or skip rows', async () => {
      table = [imageRow({ brand_id: 'b1', url: 'u1' })]

      await hydrateCardImageMeta(client(), [brand('b1', 'u1')])

      expect(queries[0]?.orders).toEqual(['brand_id', 'sort_order', 'id'])
    })
  })

  describe('read failure', () => {
    it('degrades to unhydrated brands rather than throwing', async () => {
      // Decorative metadata must never take a page down, and this is also the
      // deploy-order guard: between a Railway deploy and the manual
      // `supabase db push`, `focal_x` does not exist and PostgREST answers
      // 42703 on every card surface at once.
      queryError = { message: 'column brand_images.focal_x does not exist', code: '42703' }
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      const hydrated = await hydrateCardImageMeta(client(), [
        brand('b1', 'https://x.supabase.co/hero.webp'),
      ])

      expect(hydrated).toHaveLength(1)
      expect(hydrated[0]?.imageAlts).toEqual([])
      expect(hydrated[0]?.heroImageMetadata).toBeNull()
      // Degraded, not silent: `captureReadFailure` logs and reports.
      expect(consoleError).toHaveBeenCalled()
      consoleError.mockRestore()
    })

    it('preserves the caller-supplied fields it does not own', async () => {
      queryError = { message: 'connection reset' }
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      const [hydrated] = await hydrateCardImageMeta(client(), [
        { ...brand('b1', 'https://x.supabase.co/hero.webp'), name: 'Molasses' },
      ])

      expect(hydrated?.name).toBe('Molasses')
      consoleError.mockRestore()
    })
  })
})
