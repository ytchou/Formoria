import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildReferenceSet,
  categorizeObjects,
  isMissingTableError,
  parseTargetedPurgeKeys,
  planTargetedPurge,
  planPurge,
  selectPurgeableManifests,
  shouldReencode,
} from '../brand-storage-maintenance'

const refs = {
  activePaths: new Set(['brands/b1/live.webp', 'submissions/s1/hero.png']),
  rejectedPaths: new Set(['brands/b1/junk.jpg']),
  otherReferencedPaths: new Set(['brands/b1/draft-ref.jpg']),
  soakProtectedPaths: new Set(['brands/b1/old-original.jpg']),
}

it.each([
  [
    {
      path: 'brands/b/x.jpg',
      size: 900_000,
      contentType: 'image/jpeg',
      jsonbReferenced: false,
    },
    true,
  ],
  [
    {
      path: 'brands/b/x.webp',
      size: 90_000,
      contentType: 'image/webp',
      jsonbReferenced: false,
    },
    false,
  ],
  [
    {
      path: 'brands/b/x.webp',
      size: 400_000,
      contentType: 'image/webp',
      jsonbReferenced: false,
    },
    true,
  ],
  [
    {
      path: 'brands/b/x.gif',
      size: 900_000,
      contentType: 'image/gif',
      jsonbReferenced: false,
    },
    false,
  ],
  [
    {
      path: 'brands/b/x.jpg',
      size: 900_000,
      contentType: 'image/jpeg',
      jsonbReferenced: true,
    },
    false,
  ],
])('shouldReencode(%o) -> %s', (obj, expected) => {
  expect(shouldReencode(obj, { webpSkipBytes: 150 * 1024 })).toBe(expected)
})

it('only selects manifests at least 7 days old', () => {
  const now = new Date('2026-07-25T00:00:00Z')
  const manifests = [
    {
      file: '.reencode-originals-2026-07-16T00-00-00.json',
      createdAt: new Date('2026-07-16T00:00:00Z'),
    },
    {
      file: '.reencode-originals-2026-07-20T00-00-00.json',
      createdAt: new Date('2026-07-20T00:00:00Z'),
    },
  ]

  expect(selectPurgeableManifests(manifests, now).map((m) => m.file)).toEqual([
    '.reencode-originals-2026-07-16T00-00-00.json',
  ])
})

describe('categorizeObjects', () => {
  it('categorizes bucket objects into live / rejected / untracked / protected', () => {
    const objects = [
      { path: 'brands/b1/live.webp', size: 100 },
      { path: 'submissions/s1/hero.png', size: 100 },
      { path: 'brands/b1/junk.jpg', size: 200 },
      { path: 'brands/b1/nobody-knows.bin', size: 300 },
      { path: 'index.html', size: 10 },
      { path: 'brands/b1/draft-ref.jpg', size: 50 },
      { path: 'brands/b1/old-original.jpg', size: 400 },
    ]

    const result = categorizeObjects(objects, refs)

    expect(result.live.map((object) => object.path)).toEqual([
      'brands/b1/live.webp',
      'submissions/s1/hero.png',
    ])
    expect(result.rejected.map((object) => object.path)).toEqual([
      'brands/b1/junk.jpg',
    ])
    expect(result.untracked.map((object) => object.path)).toEqual([
      'brands/b1/nobody-knows.bin',
      'index.html',
    ])
    expect(result.protected.map((object) => object.path)).toEqual(
      expect.arrayContaining([
        'brands/b1/draft-ref.jpg',
        'brands/b1/old-original.jpg',
      ]),
    )
  })

  it('a rejected path that is also referenced elsewhere is an anomaly, never deletable', () => {
    const path = 'brands/b1/rejected-but-hero.jpg'
    const result = categorizeObjects([{ path, size: 1 }], {
      ...refs,
      rejectedPaths: new Set([path]),
      otherReferencedPaths: new Set([path]),
    })

    expect(result.anomalies.map((object) => object.path)).toEqual([path])
    expect(result.rejected).toEqual([])
  })

  it('a roster-owned event-exhibitors object is referenced, never untracked', () => {
    const path = `event-exhibitors/${randomUUID()}/${randomUUID()}.webp`
    const result = categorizeObjects([{ path, size: 1 }], {
      ...refs,
      // What buildReferenceSet produces for an event_exhibitors row whose
      // image_storage_path is set — see the buildReferenceSet suite below.
      otherReferencedPaths: new Set([path]),
    })

    expect(result.protected.map((object) => object.path)).toEqual([path])
    expect(result.untracked).toEqual([])
    expect(result.rejected).toEqual([])
  })
})

/**
 * `curated-products/` objects (DEV-1404) are referenced only by
 * `curated_products.image_url`, a public URL — no image table row exists for
 * them. Without both the prefix registration and the matching read in
 * buildReferenceSet, every live curated image is `untracked` and the purge
 * deletes it days later with no error.
 */
describe('curated-products prefix', () => {
  const supabaseUrl = 'https://test-project.supabase.co'
  const publicUrlFor = (key: string) =>
    `${supabaseUrl}/storage/v1/object/public/brand-images/${key}`

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('a curated-products object is referenced, never untracked', async () => {
    const key = `curated-products/${randomUUID()}/${randomUUID()}/x.webp`
    const refsFromDb = await buildReferenceSet(
      stubReferenceClient({
        brand_images: [],
        submission_images: [],
        brands: [],
        brand_submissions: [],
        event_exhibitors: [],
        curated_products: [
          { image_url: publicUrlFor(key) },
          { image_url: null },
        ],
      }),
    )

    expect(refsFromDb.otherReferencedPaths.has(key)).toBe(true)

    const categorized = categorizeObjects([{ path: key, size: 1 }], refsFromDb)
    expect(categorized.protected.map((object) => object.path)).toEqual([key])
    expect(categorized.untracked).toEqual([])
    expect(categorized.rejected).toEqual([])

    const plan = planPurge(categorized, {
      expectedRejected: 0,
      expectedUntracked: 0,
      tolerance: 0.15,
    })
    expect(plan.toDelete).not.toContain(key)
  })

  it('an orphaned curated-products object with no referencing row is untracked', async () => {
    const orphanKey = `curated-products/${randomUUID()}/${randomUUID()}/dead.webp`
    const refsFromDb = await buildReferenceSet(
      stubReferenceClient({
        brand_images: [],
        submission_images: [],
        brands: [],
        brand_submissions: [],
        event_exhibitors: [],
        curated_products: [],
      }),
    )

    const categorized = categorizeObjects(
      [{ path: orphanKey, size: 1 }],
      refsFromDb,
    )

    expect(categorized.untracked.map((object) => object.path)).toEqual([
      orphanKey,
    ])
    expect(categorized.protected).toEqual([])
  })
})

/**
 * Chainable stand-in for the service client. This is a plain argument, not a
 * module mock: `scripts/check-test-boundaries.mjs` forbids vi.mock of
 * `@/lib/supabase/` and `@supabase/`, and buildReferenceSet takes its client as
 * a parameter precisely so it can be driven this way.
 *
 * Ceiling: it only models select/not/order/range and returns a single page. If
 * buildReferenceSet ever needs real filtering or pagination semantics, replace
 * this with an integration test against a seeded project rather than growing
 * the stub.
 */
function stubReferenceClient(
  rowsByTable: Record<string, unknown[]>,
  errorsByTable: Record<string, { message: string; code?: string }> = {},
): Parameters<typeof buildReferenceSet>[0] {
  const client = {
    from(table: string) {
      const chain = {
        select: () => chain,
        not: () => chain,
        order: () => chain,
        range: () =>
          Promise.resolve(
            errorsByTable[table]
              ? { data: null, error: errorsByTable[table] }
              : { data: rowsByTable[table] ?? [], error: null },
          ),
      }
      return chain
    },
  }
  return client as unknown as Parameters<typeof buildReferenceSet>[0]
}

describe('buildReferenceSet', () => {
  it('treats event_exhibitors.image_storage_path as a reference', async () => {
    const rosterKey = `event-exhibitors/${randomUUID()}/${randomUUID()}.webp`
    const refsFromDb = await buildReferenceSet(
      stubReferenceClient({
        brand_images: [],
        submission_images: [],
        brands: [],
        brand_submissions: [],
        event_exhibitors: [
          { image_storage_path: rosterKey },
          { image_storage_path: null },
        ],
      }),
    )

    expect(refsFromDb.otherReferencedPaths.has(rosterKey)).toBe(true)

    const result = categorizeObjects([{ path: rosterKey, size: 1 }], refsFromDb)
    expect(result.protected.map((object) => object.path)).toEqual([rosterKey])
    expect(result.untracked).toEqual([])
  })
})

/**
 * The guard exists for exactly one environment — one where the DEV-1404
 * migration has not been applied — so nothing else exercises it. It was
 * originally written against the raw Postgres code, which PostgREST never
 * returns, making it dead code that aborted the whole audit.
 */
describe('missing curated_products table', () => {
  it.each([
    ['PGRST205', true],
    ['42P01', true],
    ['42501', false],
    [undefined, false],
  ])('isMissingTableError(%s) -> %s', (code, expected) => {
    expect(isMissingTableError(code ? { code } : {})).toBe(expected)
  })

  it('isMissingTableError(null) -> false', () => {
    expect(isMissingTableError(null)).toBe(false)
  })

  it('skips curated_products references when PostgREST cannot find the table', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const refsFromDb = await buildReferenceSet(
      stubReferenceClient(
        {
          brand_images: [],
          submission_images: [],
          brands: [],
          brand_submissions: [],
          event_exhibitors: [],
        },
        {
          curated_products: {
            code: 'PGRST205',
            message:
              "Could not find the table 'public.curated_products' in the schema cache",
          },
        },
      ),
    )

    expect(refsFromDb.otherReferencedPaths.size).toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('still throws on an error that is not a missing table', async () => {
    await expect(
      buildReferenceSet(
        stubReferenceClient(
          {
            brand_images: [],
            submission_images: [],
            brands: [],
            brand_submissions: [],
            event_exhibitors: [],
          },
          { curated_products: { code: '42501', message: 'permission denied' } },
        ),
      ),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('planPurge', () => {
  const categorized = {
    protected: [{ path: 'brands/protected.webp', size: 100 }],
    anomalies: [{ path: 'brands/anomaly.webp', size: 100 }],
    live: [{ path: 'brands/live.webp', size: 100 }],
    rejected: Array.from({ length: 1_820 }, (_, index) => ({
      path: `brands/rejected-${index}.webp`,
      size: 100,
    })),
    untracked: Array.from({ length: 2_056 }, (_, index) => ({
      path: `brands/untracked-${index}.webp`,
      size: 100,
    })),
  }

  it('plans deletions for rejected+untracked, respects sanity gate', () => {
    const plan = planPurge(categorized, {
      expectedRejected: 1_820,
      expectedUntracked: 2_056,
      tolerance: 0.15,
    })

    expect(plan.toDelete).toEqual(
      [...categorized.rejected, ...categorized.untracked].map(
        (object) => object.path,
      ),
    )
    expect(plan.withinSanityGate).toBe(true)
  })

  it('fails the sanity gate when counts deviate beyond tolerance', () => {
    const categorizedTiny = {
      ...categorized,
      rejected: [{ path: 'brands/rejected.webp', size: 100 }],
      untracked: [{ path: 'brands/untracked.webp', size: 100 }],
    }
    const plan = planPurge(categorizedTiny, {
      expectedRejected: 1_820,
      expectedUntracked: 2_056,
      tolerance: 0.15,
    })

    expect(plan.withinSanityGate).toBe(false)
  })

  it('excludes soak-protected keys from untracked deletions', () => {
    const protectedPath = 'brands/reencode-original.webp'
    const categorizedWithSoakProtection = categorizeObjects(
      [
        { path: protectedPath, size: 100 },
        { path: 'brands/untracked.webp', size: 100 },
      ],
      {
        activePaths: new Set(),
        rejectedPaths: new Set(),
        otherReferencedPaths: new Set(),
        soakProtectedPaths: new Set([protectedPath]),
      },
    )

    const plan = planPurge(categorizedWithSoakProtection, {
      expectedRejected: 0,
      expectedUntracked: 1,
      tolerance: 0.15,
    })

    expect(categorizedWithSoakProtection.protected).toEqual([
      { path: protectedPath, size: 100 },
    ])
    expect(plan.toDelete).not.toContain(protectedPath)
  })
})

describe('planTargetedPurge', () => {
  it('deletes only requested objects that still exist and remain unreferenced', () => {
    const orphan = 'brands/deleted-brand/orphan.webp'
    const nowReferenced = 'brands/deleted-brand/restored.webp'

    expect(
      planTargetedPurge(
        [
          orphan,
          nowReferenced,
          'brands/deleted-brand/missing.webp',
          '/invalid',
        ],
        [
          { path: orphan, size: 100 },
          { path: nowReferenced, size: 200 },
        ],
        {
          activePaths: new Set([nowReferenced]),
          rejectedPaths: new Set(),
          otherReferencedPaths: new Set(),
          soakProtectedPaths: new Set(),
        },
      ),
    ).toEqual({
      toDelete: [orphan],
      missing: ['brands/deleted-brand/missing.webp'],
      referenced: [nowReferenced],
      invalid: ['/invalid'],
    })
  })
})

describe('parseTargetedPurgeKeys', () => {
  it('reads exact storage keys from a deleted brand-images backup', () => {
    expect(
      parseTargetedPurgeKeys(
        JSON.stringify([
          {
            storage_path: 'brands/brand-id/from-path.webp',
            url: 'https://project.supabase.co/storage/v1/object/public/brand-images/brands/brand-id/ignored.webp',
          },
          {
            storage_path: null,
            url: 'https://project.supabase.co/storage/v1/object/public/brand-images/brands/brand-id/from-url.webp',
          },
        ]),
      ),
    ).toEqual([
      'brands/brand-id/from-path.webp',
      'brands/brand-id/from-url.webp',
    ])
  })
})
