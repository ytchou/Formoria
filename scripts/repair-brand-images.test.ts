import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyReactivations,
  detectJunkAnomalies,
  detectReactivationAnomalies,
  planBrandHides,
  planHeroResync,
  planReactivations,
  probeUrlReachable,
  selectJunkRows,
  type ReactivationDecision,
  type RejectedImageRow,
  type RepairableImageTable,
} from './repair-brand-images'

const SUPABASE_URL = 'https://xkcayngbttpxyibgzern.supabase.co'
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/brand-images/`
const LIVE_KEY = 'brands/tmp/heroImageUrl/1784881848670-live.webp'
const MISSING_KEY = 'brands/tmp/heroImageUrl/1784881848670-gone.webp'
// Still present in the bucket — pass (c) rejects the row but deliberately
// leaves storage_path and the object intact so the run stays reversible.
const JUNK_KEY = 'brands/tmp/heroImageUrl/1784881848670-junk.webp'

type Brand = {
  id: string
  slug: string
  hero_image_url: string | null
  status: string
}

function makeBrand(
  id: string,
  slug: string,
  hero_image_url: string | null,
  status = 'approved',
): Brand {
  return { id, slug, hero_image_url, status }
}

function plan(
  brand: Brand,
  activeAfter: number,
  existing: string[] = [LIVE_KEY],
  junk: string[] = [],
) {
  const entries = planHeroResync({
    affectedBrandIds: [brand.id],
    brandById: new Map([[brand.id, brand]]),
    activeCountsAfter: new Map([[brand.id, activeAfter]]),
    existingPaths: new Set(existing),
    junkPaths: new Set(junk),
  })
  return entries[0]!
}

describe('planHeroResync', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('resyncs brands that still have active rows', () => {
    const entry = plan(
      makeBrand('b1', 'keeps-rows', `${PUBLIC_PREFIX}${MISSING_KEY}`),
      2,
    )
    expect(entry.action).toBe('sync')
  })

  // The defect this planner exists for: a brand whose only active row was
  // rejected, but whose denormalized hero url still points at a live object.
  // Resyncing would null it and leave the detail page on the fallback tile.
  it('keeps a live hero url when no active rows remain', () => {
    const entry = plan(
      makeBrand('b2', 'entadar', `${PUBLIC_PREFIX}${LIVE_KEY}`),
      0,
    )
    expect(entry.action).toBe('keep')
    expect(entry.reason).toContain(LIVE_KEY)
  })

  // The dominant real-world case (~66 brands): the brand's only image was the
  // junk row, so the object is still live only because pass (c) leaves it in
  // place. Keeping the hero would re-display the exact junk being rejected.
  it('clears a hero url pointing at an object this run rejects as junk', () => {
    const entry = plan(
      makeBrand('b8', 'junk-hero', `${PUBLIC_PREFIX}${JUNK_KEY}`),
      0,
      [LIVE_KEY, JUNK_KEY],
      [JUNK_KEY],
    )
    expect(entry.action).toBe('clear')
    expect(entry.reason).toContain('junk')
    expect(entry.reason).toContain(JUNK_KEY)
  })

  it('clears a hero url whose object is gone from the bucket', () => {
    const entry = plan(
      makeBrand('b3', 'rotted', `${PUBLIC_PREFIX}${MISSING_KEY}`),
      0,
    )
    expect(entry.action).toBe('clear')
  })

  it('clears a hero url that is not a bucket url', () => {
    const entry = plan(
      makeBrand('b4', 'hotlinked', 'https://cdn.example.com/hero.jpg'),
      0,
    )
    expect(entry.action).toBe('clear')
  })

  it('skips brands with no hero url and no active rows', () => {
    expect(plan(makeBrand('b5', 'empty', null), 0).action).toBe('skip')
    expect(plan(makeBrand('b6', 'blank', '   '), 0).action).toBe('skip')
  })

  it('treats a brand missing from the count map as having zero active rows', () => {
    const brand = makeBrand('b7', 'uncounted', `${PUBLIC_PREFIX}${LIVE_KEY}`)
    const entries = planHeroResync({
      affectedBrandIds: [brand.id],
      brandById: new Map([[brand.id, brand]]),
      activeCountsAfter: new Map(),
      existingPaths: new Set([LIVE_KEY]),
      junkPaths: new Set(),
    })
    expect(entries[0]!.action).toBe('keep')
  })

  it('falls back to the brand id as slug when the brand row is absent', () => {
    const entries = planHeroResync({
      affectedBrandIds: ['ghost'],
      brandById: new Map(),
      activeCountsAfter: new Map(),
      existingPaths: new Set(),
      junkPaths: new Set(),
    })
    expect(entries[0]!.slug).toBe('ghost')
    expect(entries[0]!.action).toBe('skip')
  })
})

type ImageRow = {
  id: string
  brand_id: string
  url: string
  storage_path: string | null
  status: string
  source: string | null
  sort_order: number | null
  tags: string[] | null
  score: number | null
}

function makeRow(
  id: string,
  brandId: string,
  tags: string[] | null,
  status = 'active',
  score: number | null = 60,
): ImageRow {
  return {
    id,
    brand_id: brandId,
    url: `${PUBLIC_PREFIX}${id}.webp`,
    storage_path: `brands/${brandId}/${id}.webp`,
    status,
    source: 'scrape',
    sort_order: 0,
    tags,
    score,
  }
}

describe('selectJunkRows', () => {
  it('selects active rows whose tags intersect JUNK_TAGS', () => {
    const { junkRows } = selectJunkRows({
      rows: [
        makeRow('r1', 'b1', ['promo']),
        makeRow('r2', 'b1', ['text_banner']),
        makeRow('r3', 'b1', ['irrelevant']),
        makeRow('r4', 'b1', ['product']),
        makeRow('r5', 'b1', null),
      ],
      includeLogos: false,
    })
    expect(junkRows.map((row) => row.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('ignores rows that are not active', () => {
    const { junkRows } = selectJunkRows({
      rows: [makeRow('r1', 'b1', ['promo'], 'rejected')],
      includeLogos: false,
    })
    expect(junkRows).toEqual([])
  })

  // A clean brand mark beats a letter tile, so logo-only rows are kept unless
  // --include-logos is passed.
  it('excludes logo-only rows by default and reports them separately', () => {
    const { junkRows, excludedLogoRows } = selectJunkRows({
      rows: [makeRow('r1', 'b1', ['logo'], 'active', 85)],
      includeLogos: false,
    })
    expect(junkRows).toEqual([])
    expect(excludedLogoRows.map((row) => row.id)).toEqual(['r1'])
  })

  it('includes logo rows when includeLogos is set', () => {
    const { junkRows, excludedLogoRows } = selectJunkRows({
      rows: [makeRow('r1', 'b1', ['logo'], 'active', 85)],
      includeLogos: true,
    })
    expect(junkRows.map((row) => row.id)).toEqual(['r1'])
    expect(excludedLogoRows).toEqual([])
  })

  it('still selects a logo row that also carries a non-excluded junk tag', () => {
    const { junkRows } = selectJunkRows({
      rows: [makeRow('r1', 'b1', ['logo', 'promo'])],
      includeLogos: false,
    })
    expect(junkRows.map((row) => row.id)).toEqual(['r1'])
  })
})

describe('planBrandHides', () => {
  function hides(input: {
    affectedBrandIds: string[]
    before: Array<[string, number]>
    after: Array<[string, number]>
    brands: Brand[]
    heroPlan?: Array<{
      brandId: string
      slug: string
      action: 'sync' | 'keep' | 'clear' | 'skip'
      reason: string
    }>
  }) {
    return planBrandHides({
      affectedBrandIds: input.affectedBrandIds,
      activeCountsBefore: new Map(input.before),
      activeCountsAfter: new Map(input.after),
      brandById: new Map(input.brands.map((entry) => [entry.id, entry])),
      heroPlan: input.heroPlan ?? [],
    })
  }

  it('hides an approved brand this pass emptied', () => {
    const entries = hides({
      affectedBrandIds: ['b1'],
      before: [['b1', 1]],
      after: [['b1', 0]],
      brands: [makeBrand('b1', 'emptied', null)],
    })
    expect(entries).toEqual([
      { brandId: 'b1', slug: 'emptied', priorStatus: 'approved' },
    ])
  })

  it('leaves brands that still have active rows alone', () => {
    expect(
      hides({
        affectedBrandIds: ['b1'],
        before: [['b1', 3]],
        after: [['b1', 2]],
        brands: [makeBrand('b1', 'survives', null)],
      }),
    ).toEqual([])
  })

  // Guard: a brand that was already imageless was not emptied by this run.
  it('never hides a brand that already had zero active images', () => {
    expect(
      hides({
        affectedBrandIds: ['b1'],
        before: [['b1', 0]],
        after: [['b1', 0]],
        brands: [makeBrand('b1', 'always-empty', null)],
      }),
    ).toEqual([])
  })

  it('never touches a brand that is not approved', () => {
    expect(
      hides({
        affectedBrandIds: ['b1'],
        before: [['b1', 1]],
        after: [['b1', 0]],
        brands: [makeBrand('b1', 'already-hidden', null, 'hidden')],
      }),
    ).toEqual([])
  })

  it('ignores brands this run did not touch', () => {
    expect(
      hides({
        affectedBrandIds: [],
        before: [['b1', 1]],
        after: [['b1', 0]],
        brands: [makeBrand('b1', 'untouched', null)],
      }),
    ).toEqual([])
  })

  // The contradiction case: pass (a) rejects the brand's dangling row and pass
  // (c) rejects its junk row, so `after` is 0 — but the hero planner has already
  // decided `keep` because hero_image_url still resolves to a live object. The
  // detail page still renders an image; delisting it would 404 a brand the
  // repair otherwise left intact, which is worse than the bug.
  it('never hides a brand whose hero url the hero plan decided to keep', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)
    try {
      const brand = makeBrand('b1', 'mixed', `${PUBLIC_PREFIX}${LIVE_KEY}`)
      const heroEntry = plan(brand, 0)
      expect(heroEntry.action).toBe('keep')

      expect(
        hides({
          // Emptied by pass (a) + pass (c) together, but the hero survives.
          affectedBrandIds: ['b1'],
          before: [['b1', 2]],
          after: [['b1', 0]],
          brands: [brand],
          heroPlan: [heroEntry],
        }),
      ).toEqual([])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('still hides an emptied brand whose hero plan says clear', () => {
    const entries = hides({
      affectedBrandIds: ['b1'],
      before: [['b1', 1]],
      after: [['b1', 0]],
      brands: [makeBrand('b1', 'emptied', null)],
      heroPlan: [
        { brandId: 'b1', slug: 'emptied', action: 'clear', reason: 'broken' },
      ],
    })
    expect(entries).toHaveLength(1)
  })

  it('reports each emptied brand once even if listed twice', () => {
    const entries = hides({
      affectedBrandIds: ['b1', 'b1'],
      before: [['b1', 2]],
      after: [['b1', 0]],
      brands: [makeBrand('b1', 'emptied', null)],
    })
    expect(entries).toHaveLength(1)
  })
})

// Wires the three pure planners the way repair() does, so the hero/hide
// interaction is exercised end to end rather than with a hand-written heroPlan.
describe('pass (c) hero/hide interaction', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function run(input: {
    rows: ImageRow[]
    brands: Brand[]
    includeLogos?: boolean
    /** Rows rejected by pass (a); they are removed but are not junk. */
    danglingRowIds?: string[]
    /** Rows deleted by pass (b) hotlink removal; also not junk. */
    externalRowIds?: string[]
    existingPaths: string[]
  }) {
    const { junkRows } = selectJunkRows({
      rows: input.rows,
      includeLogos: input.includeLogos ?? false,
    })
    const removedIds = new Set([
      ...(input.danglingRowIds ?? []),
      ...(input.externalRowIds ?? []),
      ...junkRows.map((row) => row.id),
    ])

    const countActive = (rows: ImageRow[]) => {
      const counts = new Map<string, number>()
      for (const row of rows) {
        if (row.status !== 'active') continue
        counts.set(row.brand_id, (counts.get(row.brand_id) ?? 0) + 1)
      }
      return counts
    }
    const before = countActive(input.rows)
    const after = countActive(
      input.rows.filter((row) => !removedIds.has(row.id)),
    )

    const affectedBrandIds = [
      ...new Set(
        input.rows
          .filter((row) => removedIds.has(row.id))
          .map((row) => row.brand_id),
      ),
    ]
    const junkPaths = new Set(
      junkRows
        .map((row) => row.storage_path)
        .filter((storagePath): storagePath is string => storagePath !== null),
    )
    const brandById = new Map(input.brands.map((brand) => [brand.id, brand]))

    const heroPlan = planHeroResync({
      affectedBrandIds,
      brandById,
      activeCountsAfter: after,
      existingPaths: new Set(input.existingPaths),
      junkPaths,
    })
    const brandsToHide = planBrandHides({
      affectedBrandIds,
      activeCountsBefore: before,
      activeCountsAfter: after,
      brandById,
      heroPlan,
    })

    return { junkRows, heroPlan, brandsToHide }
  }

  function junkRow(id: string, brandId: string, key: string): ImageRow {
    return {
      ...makeRow(id, brandId, ['promo']),
      url: `${PUBLIC_PREFIX}${key}`,
      storage_path: key,
    }
  }

  // ~66 brands look like this: the only image was junk, and the hero points at
  // that junk object — which stays live because pass (c) does not delete it.
  it('clears the hero and hides a brand whose only image was junk', () => {
    const brand = makeBrand('b1', 'junk-only', `${PUBLIC_PREFIX}${JUNK_KEY}`)
    const { heroPlan, brandsToHide } = run({
      rows: [junkRow('r1', 'b1', JUNK_KEY)],
      brands: [brand],
      existingPaths: [JUNK_KEY],
    })

    expect(heroPlan).toHaveLength(1)
    expect(heroPlan[0]!.action).toBe('clear')
    expect(brandsToHide.map((entry) => entry.slug)).toEqual(['junk-only'])
  })

  // Regression guard for the branch the junk check must not swallow: pass (a)
  // emptied this brand, but its hero is a genuine live object, so nulling it
  // would leave the brand strictly worse off than the bug.
  it('keeps a live non-junk hero and does not hide the brand', () => {
    const brand = makeBrand('b1', 'dangling-only', `${PUBLIC_PREFIX}${LIVE_KEY}`)
    const { heroPlan, brandsToHide } = run({
      rows: [
        junkRow('r1', 'b1', MISSING_KEY),
        // Another brand's junk row, so junkPaths is non-empty and the check is
        // proven to discriminate rather than to be vacuously false.
        junkRow('r2', 'b2', JUNK_KEY),
      ],
      brands: [brand, makeBrand('b2', 'other', null)],
      danglingRowIds: ['r1'],
      existingPaths: [LIVE_KEY, JUNK_KEY],
    })

    const entry = heroPlan.find((item) => item.brandId === 'b1')!
    expect(entry.action).toBe('keep')
    expect(brandsToHide.map((item) => item.brandId)).not.toContain('b1')
  })

  /** A clean, untagged bucket-hosted row — removed by pass (a), never by (c). */
  function plainRow(id: string, brandId: string, key: string): ImageRow {
    return {
      ...makeRow(id, brandId, null),
      url: `${PUBLIC_PREFIX}${key}`,
      storage_path: key,
    }
  }

  /** A legacy hotlink row: third-party host, never mirrored into the bucket. */
  function hotlinkRow(id: string, brandId: string): ImageRow {
    return {
      ...makeRow(id, brandId, null),
      url: `https://cdn.example.com/${id}.jpg`,
      storage_path: null,
    }
  }

  // The case the junk-only rule missed: pass (b) deletes every hotlink row,
  // including the currently-active ones, so a brand with no junk row at all can
  // be left imageless.
  it('hides a brand emptied only by pass (b) hotlink deletion', () => {
    const brand = makeBrand('b1', 'hotlink-only', 'https://cdn.example.com/r1.jpg')
    const { junkRows, heroPlan, brandsToHide } = run({
      rows: [hotlinkRow('r1', 'b1')],
      brands: [brand],
      externalRowIds: ['r1'],
      existingPaths: [LIVE_KEY],
    })

    expect(junkRows).toEqual([])
    expect(heroPlan[0]!.action).toBe('clear')
    expect(brandsToHide.map((entry) => entry.slug)).toEqual(['hotlink-only'])
  })

  it('hides a brand emptied only by pass (a) whose hero is also gone', () => {
    const brand = makeBrand('b1', 'dangling-dead-hero', `${PUBLIC_PREFIX}${MISSING_KEY}`)
    const { junkRows, heroPlan, brandsToHide } = run({
      rows: [plainRow('r1', 'b1', MISSING_KEY)],
      brands: [brand],
      danglingRowIds: ['r1'],
      existingPaths: [LIVE_KEY],
    })

    expect(junkRows).toEqual([])
    expect(heroPlan[0]!.action).toBe('clear')
    expect(brandsToHide.map((entry) => entry.slug)).toEqual(['dangling-dead-hero'])
  })

  // The preserved veto: zero active rows, but the detail page still renders a
  // real image from hero_image_url, so the brand is not imageless to a visitor.
  it('does not hide a pass (a) brand whose hero still resolves live', () => {
    const brand = makeBrand('b1', 'dangling-live-hero', `${PUBLIC_PREFIX}${LIVE_KEY}`)
    const { junkRows, heroPlan, brandsToHide } = run({
      rows: [plainRow('r1', 'b1', MISSING_KEY)],
      brands: [brand],
      danglingRowIds: ['r1'],
      existingPaths: [LIVE_KEY],
    })

    expect(junkRows).toEqual([])
    expect(heroPlan[0]!.action).toBe('keep')
    expect(brandsToHide).toEqual([])
  })

  it('leaves a logo-only brand entirely alone while logos are excluded', () => {
    const logoKey = 'brands/b1/logo.webp'
    const brand = makeBrand('b1', 'logo-only', `${PUBLIC_PREFIX}${logoKey}`)
    const { junkRows, heroPlan, brandsToHide } = run({
      rows: [{ ...junkRow('r1', 'b1', logoKey), tags: ['logo'], score: 85 }],
      brands: [brand],
      existingPaths: [logoKey],
    })

    expect(junkRows).toEqual([])
    expect(heroPlan).toEqual([])
    expect(brandsToHide).toEqual([])
  })
})

describe('detectJunkAnomalies', () => {
  function hideEntries(count: number) {
    return Array.from({ length: count }, (_value, index) => ({
      brandId: `b${index}`,
      slug: `brand-${index}`,
      priorStatus: 'approved',
    }))
  }

  it('passes at the expected defect volume (~66 brands)', () => {
    expect(detectJunkAnomalies(hideEntries(66))).toEqual([])
  })

  it('passes exactly at the threshold', () => {
    expect(detectJunkAnomalies(hideEntries(80))).toEqual([])
  })

  it('blocks one brand above the threshold', () => {
    const anomalies = detectJunkAnomalies(hideEntries(81))
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]).toContain('81')
  })
})

// ---------------------------------------------------------------------------
// Pass (d) — reactivating rejections the classifier never gave a verdict for.
// ---------------------------------------------------------------------------

const OURS_KEY = 'brands/b1/1784881848670-recoverable.webp'

function rejectedRow(
  id: string,
  url: string,
  overrides: Partial<RejectedImageRow> = {},
): RejectedImageRow {
  return {
    id,
    url,
    status: 'rejected',
    // Every affected row has a null storage_path — that is precisely why the
    // bucket listing cannot answer reachability and the url must be probed.
    storage_path: null,
    source: 'scrape',
    tags: null,
    ...overrides,
  }
}

function candidate(
  row: RejectedImageRow,
  table: RepairableImageTable = 'brand_images',
) {
  return { table, row }
}

describe('planReactivations', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('reactivates a row whose url still resolves, leaving tags null', async () => {
    const probe = vi.fn(async () => true)
    const decisions = await planReactivations({
      candidates: [candidate(rejectedRow('r1', `${PUBLIC_PREFIX}${OURS_KEY}`))],
      probe,
    })

    expect(decisions).toHaveLength(1)
    expect(decisions[0]!.action).toBe('reactivate')
    // The whole point: no tag and no score are invented, so the fixed
    // classifier picks the row up and gives it a real verdict next run.
    expect(decisions[0]!.row.tags).toBeNull()
    expect(probe).toHaveBeenCalledWith(`${PUBLIC_PREFIX}${OURS_KEY}`)
  })

  // Fail closed: reactivating a row whose bytes are gone recreates the dangling
  // row of pass (a), which renders as a permanent broken letter-tile.
  it('leaves a row rejected when the url 404s', async () => {
    const decisions = await planReactivations({
      candidates: [candidate(rejectedRow('r1', `${PUBLIC_PREFIX}${OURS_KEY}`))],
      probe: async () => false,
    })
    expect(decisions[0]!.action).toBe('skip')
    expect(decisions[0]!.reason).toContain('2xx')
  })

  it('leaves a row rejected when the probe throws (network error / timeout)', async () => {
    const decisions = await planReactivations({
      candidates: [candidate(rejectedRow('r1', `${PUBLIC_PREFIX}${OURS_KEY}`))],
      probe: async () => {
        throw new Error('ETIMEDOUT')
      },
    })
    expect(decisions[0]!.action).toBe('skip')
  })

  it('keeps processing the remaining candidates after a probe throws', async () => {
    const probe = vi.fn(async (url: string) => {
      if (url.endsWith('boom.webp')) throw new Error('ECONNRESET')
      return true
    })
    const decisions = await planReactivations({
      candidates: [
        candidate(rejectedRow('r1', `${PUBLIC_PREFIX}brands/b1/boom.webp`)),
        candidate(rejectedRow('r2', `${PUBLIC_PREFIX}${OURS_KEY}`)),
      ],
      probe,
    })
    expect(decisions.map((entry) => entry.action)).toEqual([
      'skip',
      'reactivate',
    ])
  })

  it('never probes or touches a url outside our storage prefix', async () => {
    const probe = vi.fn(async () => true)
    const decisions = await planReactivations({
      candidates: [
        candidate(rejectedRow('r1', 'https://cdn.example.com/hero.jpg')),
        // Right host, wrong bucket path — storageKeyFromPublicUrl rejects it.
        candidate(rejectedRow('r2', `${SUPABASE_URL}/storage/v1/object/public/claim-proofs/x.webp`)),
        candidate(rejectedRow('r3', 'not a url at all')),
      ],
      probe,
    })

    expect(decisions.every((entry) => entry.action === 'skip')).toBe(true)
    expect(decisions[0]!.reason).toContain('prefix')
    expect(probe).not.toHaveBeenCalled()
  })

  // A real junk verdict always writes a tag. Reverting one would re-publish an
  // image a working classifier deliberately removed.
  it('treats a row with non-null tags as out of scope', async () => {
    const probe = vi.fn(async () => true)
    const decisions = await planReactivations({
      candidates: [
        candidate(
          rejectedRow('r1', `${PUBLIC_PREFIX}${OURS_KEY}`, { tags: ['promo'] }),
        ),
        // Even an empty array is a verdict: the classifier answered, it just
        // had nothing to say.
        candidate(
          rejectedRow('r2', `${PUBLIC_PREFIX}${OURS_KEY}`, { tags: [] }),
        ),
        // Not rejected at all — an active row must never be re-touched here.
        candidate(
          rejectedRow('r3', `${PUBLIC_PREFIX}${OURS_KEY}`, { status: 'active' }),
        ),
        candidate(
          rejectedRow('r4', `${PUBLIC_PREFIX}${OURS_KEY}`, {
            rejection_reasons: ['promo_subject'],
            rejected_at: '2026-07-31T00:00:00Z',
          }),
        ),
      ],
      probe,
    })

    expect(decisions.every((entry) => entry.action === 'skip')).toBe(true)
    expect(decisions[0]!.reason).toContain('out of scope')
    expect(probe).not.toHaveBeenCalled()
  })

  it('spans both brand_images and submission_images', async () => {
    const decisions = await planReactivations({
      candidates: [
        candidate(rejectedRow('r1', `${PUBLIC_PREFIX}${OURS_KEY}`), 'brand_images'),
        candidate(
          rejectedRow('r2', `${PUBLIC_PREFIX}${OURS_KEY}`),
          'submission_images',
        ),
      ],
      probe: async () => true,
    })
    expect(decisions.map((entry) => entry.table)).toEqual([
      'brand_images',
      'submission_images',
    ])
    expect(decisions.every((entry) => entry.action === 'reactivate')).toBe(true)
  })
})

describe('probeUrlReachable', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('answers true only for a 2xx response', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response('x', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(probeUrlReachable('https://example.test/a.webp')).resolves.toBe(
      true,
    )
    const request = fetchMock.mock.calls[0]!
    expect(request[1]).toMatchObject({ method: 'GET', headers: { Range: 'bytes=0-0' } })
  })

  it('answers false for a non-2xx response', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
    await expect(probeUrlReachable('https://example.test/a.webp')).resolves.toBe(
      false,
    )
  })

  it('answers false when fetch rejects', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ENOTFOUND')
    })
    await expect(probeUrlReachable('https://example.test/a.webp')).resolves.toBe(
      false,
    )
  })
})

describe('detectReactivationAnomalies', () => {
  it('passes at the measured population (1323 matched, ~10 reachable)', () => {
    expect(detectReactivationAnomalies(1_323, 10)).toEqual([])
  })

  // The whole point of the re-scoping: 99% of matched rows are already dead and
  // are discarded by the fail-closed probe, so a large candidate count must not
  // block a small repair.
  it('does not block a small repair just because many rows matched', () => {
    expect(detectReactivationAnomalies(1_323, 9)).toEqual([])
  })

  it('passes exactly at the reactivation threshold', () => {
    expect(detectReactivationAnomalies(1_323, 60)).toEqual([])
  })

  it('blocks one reactivation above the threshold', () => {
    const anomalies = detectReactivationAnomalies(1_323, 61)
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]).toContain('61')
  })

  // The outer guard: a selector that lost its `tags IS NULL` clause entirely
  // would match far beyond the known population.
  it('blocks a selector that matched far beyond the known population', () => {
    const anomalies = detectReactivationAnomalies(50_000, 0)
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]).toContain('50000')
  })

  it('reports both guards when both trip', () => {
    expect(detectReactivationAnomalies(50_000, 999)).toHaveLength(2)
  })
})

describe('applyReactivations', () => {
  type UpdateCall = {
    table: string
    payload: Record<string, unknown>
    filters: Array<[string, unknown]>
    ids: string[]
  }

  function fakeClient() {
    const calls: UpdateCall[] = []
    const client = {
      from(table: string) {
        return {
          update(payload: Record<string, unknown>) {
            const filters: Array<[string, unknown]> = []
            const builder = {
              eq(column: string, value: unknown) {
                filters.push([column, value])
                return builder
              },
              is(column: string, value: unknown) {
                filters.push([column, value])
                return builder
              },
              in(_column: string, ids: string[]) {
                calls.push({ table, payload, filters, ids })
                return Promise.resolve({ error: null })
              },
            }
            return builder
          },
        }
      },
    }
    return {
      calls,
      client: client as unknown as Parameters<typeof applyReactivations>[0],
    }
  }

  function decision(
    id: string,
    action: ReactivationDecision['action'],
    table: RepairableImageTable = 'brand_images',
  ): ReactivationDecision {
    return {
      table,
      row: rejectedRow(id, `${PUBLIC_PREFIX}${OURS_KEY}`),
      action,
      reason: 'test',
    }
  }

  // The safe default: a preview run must be indistinguishable from not running.
  it('mutates nothing in dry-run mode', async () => {
    const { client, calls } = fakeClient()
    const mutated = await applyReactivations(
      client,
      [decision('r1', 'reactivate'), decision('r2', 'reactivate')],
      false,
    )
    expect(mutated).toBe(0)
    expect(calls).toEqual([])
  })

  it('updates only the reactivate decisions, guarded by the selector', async () => {
    const { client, calls } = fakeClient()
    const mutated = await applyReactivations(
      client,
      [
        decision('r1', 'reactivate'),
        decision('r2', 'skip'),
        decision('r3', 'reactivate', 'submission_images'),
      ],
      true,
    )

    expect(mutated).toBe(2)
    expect(calls.map((call) => call.table)).toEqual([
      'brand_images',
      'submission_images',
    ])
    expect(calls[0]!.ids).toEqual(['r1'])
    expect(calls[1]!.ids).toEqual(['r3'])
    // status only — tags stay NULL so the fixed classifier reclassifies.
    expect(calls[0]!.payload).toEqual({ status: 'active' })
    // Belt-and-braces re-check of the selector at write time.
    expect(calls[0]!.filters).toEqual([
      ['status', 'rejected'],
      ['tags', null],
      ['rejection_reasons', null],
      ['rejected_at', null],
    ])
  })

  it('issues no query when nothing is reachable', async () => {
    const { client, calls } = fakeClient()
    expect(await applyReactivations(client, [decision('r1', 'skip')], true)).toBe(0)
    expect(calls).toEqual([])
  })
})
