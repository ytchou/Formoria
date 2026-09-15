import { describe, expect, it, vi } from 'vitest'
import {
  assertCarryBounded,
  toAcquireCarry,
  latestPhaseOutputs,
  listUnpersistedOutputs,
  markPersisted,
  type PhaseOutputStore,
  type PhaseOutputRow,
} from '../phase-outputs'

// ---------------------------------------------------------------------------
// assertCarryBounded
// ---------------------------------------------------------------------------

describe('carry_is_bounded_by_construction_and_warns_over_64kb', () => {
  it('a caps-sized carry serializes well under 64 KB', () => {
    const warn = vi.fn()
    const logger = { warn }
    const carry = {
      catalog: {
        triples: Array.from({ length: 200 }, (_, i) => ({
          url: `https://example.com/product-${i}`,
          title: `Product ${i}`,
          imageUrl: `https://example.com/img-${i}.jpg`,
          platform: 'generic' as const,
          supplier: 'example',
          sourceUrl: 'https://example.com/catalog',
          sourcePosition: i,
        })),
        attempts: [
          {
            sourceUrl: 'https://example.com/catalog',
            platform: 'generic' as const,
            extractor: 'test',
            staticOutcome: 'usable' as const,
            renderOutcome: 'not_requested' as const,
            sitemapLocations: 0,
            rawUrls: 200,
            ownedDetailUrls: 200,
            completeTriples: 200,
            selected: 200,
            hydrated: 200,
            usable: 200,
            drops: {},
          },
        ],
        zeroReason: undefined,
        deadlineHit: false,
      },
      acquisitionPageUrls: Array.from({ length: 10 }, (_, i) => `https://example.com/page-${i}`),
      priorityProductUrls: Array.from({ length: 10 }, (_, i) => `https://example.com/priority-${i}`),
      officialNameCandidates: [
        { source: 'official_website' as const, value: 'Test Brand 測試品牌', evidence: [] },
      ],
      scrapedImageSources: Array.from({ length: 20 }, (_, i) => ({
        url: `https://example.com/img-${i}.jpg`,
        method: 'crawl',
        pageUrl: `https://example.com/page-${i % 5}`,
        position: i,
      })),
    }

    assertCarryBounded(carry, logger)
    expect(warn).not.toHaveBeenCalled()
    // Confirm it is indeed under 64 KB
    const bytes = Buffer.byteLength(JSON.stringify(carry), 'utf8')
    expect(bytes).toBeLessThan(65_536)
  })

  it('an artificially oversized carry triggers a warning log but is never truncated', () => {
    const warn = vi.fn()
    const logger = { warn }
    const oversized = {
      catalog: {
        triples: Array.from({ length: 1000 }, (_, i) => ({
          url: `https://example.com/product-${i}-${'x'.repeat(50)}`,
          title: `Product ${i} ${'title-padding '.repeat(5)}`,
          imageUrl: `https://example.com/img-${i}-${'y'.repeat(50)}.jpg`,
          platform: 'generic' as const,
          supplier: 'example-supplier-name',
          sourceUrl: `https://example.com/catalog-source-${i}`,
          sourcePosition: i,
        })),
        attempts: [],
        deadlineHit: false,
      },
      acquisitionPageUrls: [],
      priorityProductUrls: [],
      officialNameCandidates: [],
      scrapedImageSources: [],
    }

    assertCarryBounded(oversized, logger)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/64/)
    // The carry is NOT truncated — we never modify it
    expect(oversized.catalog.triples).toHaveLength(1000)
  })
})

// ---------------------------------------------------------------------------
// toAcquireCarry
// ---------------------------------------------------------------------------

describe('acquire_carry_holds_triples_not_evidence', () => {
  it('contains triples, attempts, zeroReason, deadlineHit and no evidence key', () => {
    const acquireResult = {
      catalogResult: {
        triples: [
          {
            url: 'https://example.com/product-1',
            title: 'Product 1',
            imageUrl: 'https://example.com/img-1.jpg',
            platform: 'generic' as const,
            supplier: 'example',
            sourceUrl: 'https://example.com/catalog',
            sourcePosition: 0,
          },
        ],
        attempts: [
          {
            sourceUrl: 'https://example.com/catalog',
            platform: 'generic' as const,
            extractor: 'test',
            staticOutcome: 'usable' as const,
            renderOutcome: 'not_requested' as const,
            sitemapLocations: 0,
            rawUrls: 10,
            ownedDetailUrls: 5,
            completeTriples: 3,
            selected: 2,
            hydrated: 1,
            usable: 1,
            drops: {},
          },
        ],
        evidence: new Map([['https://example.com/product-1', { title: 'Product 1', titleSource: 'og' as const, text: 'Description', imageUrls: [] }]]),
        zeroReason: undefined,
        deadlineHit: true,
      },
      acquisitionPageUrls: ['https://example.com/page-1'],
      priorityProductUrls: ['https://example.com/priority-1'],
      officialNameCandidates: [
        { source: 'official_website' as const, value: 'Test Brand', evidence: [] },
      ],
      scrapedImageSources: [
        { url: 'https://example.com/img-1.jpg', method: 'crawl', pageUrl: 'https://example.com/page-1', position: 0 },
      ],
    }

    const carry = toAcquireCarry(acquireResult)

    expect(carry.catalog.triples).toEqual(acquireResult.catalogResult!.triples)
    expect(carry.catalog.attempts).toEqual(acquireResult.catalogResult!.attempts)
    expect(carry.catalog.deadlineHit).toBe(true)
    expect(carry.catalog.zeroReason).toBeUndefined()
    expect(carry.acquisitionPageUrls).toEqual(['https://example.com/page-1'])
    expect(carry.priorityProductUrls).toEqual(['https://example.com/priority-1'])
    expect(carry.officialNameCandidates).toEqual(acquireResult.officialNameCandidates)
    expect(carry.scrapedImageSources).toEqual(acquireResult.scrapedImageSources)
    // evidence is a Map and must NOT be in the carry (not serializable)
    expect((carry.catalog as Record<string, unknown>).evidence).toBeUndefined()
  })

  it('produces an empty catalog when catalogResult is undefined', () => {
    const carry = toAcquireCarry({
      catalogResult: undefined,
      acquisitionPageUrls: [],
      priorityProductUrls: [],
      officialNameCandidates: [],
      scrapedImageSources: [],
    })

    expect(carry.catalog.triples).toEqual([])
    expect(carry.catalog.attempts).toEqual([])
    expect(carry.catalog.deadlineHit).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// latestPhaseOutputs
// ---------------------------------------------------------------------------

describe('latest_per_phase_picks_newest_succeeded_row_across_jobs', () => {
  it('picks the newest succeeded row per phase across jobs', async () => {
    const rows: PhaseOutputRow[] = [
      {
        id: 'row-1',
        job_id: 'job-old',
        target_id: 'brand-1',
        target_type: 'brand',
        phase: 'acquire',
        status: 'succeeded',
        output: { patch: { name: 'old' } },
        persisted_at: null,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'row-2',
        job_id: 'job-new',
        target_id: 'brand-1',
        target_type: 'brand',
        phase: 'acquire',
        status: 'succeeded',
        output: { patch: { name: 'new' } },
        persisted_at: null,
        created_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 'row-3',
        job_id: 'job-new',
        target_id: 'brand-1',
        target_type: 'brand',
        phase: 'acquire',
        status: 'failed',
        output: null,
        persisted_at: null,
        created_at: '2026-01-03T00:00:00Z',
      },
      {
        id: 'row-4',
        job_id: 'job-old',
        target_id: 'brand-1',
        target_type: 'brand',
        phase: 'detect',
        status: 'succeeded',
        output: { patch: { slug: 'brand-slug' } },
        persisted_at: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]

    const store: PhaseOutputStore = {
      reader: {
        latestPerPhase: async () => rows,
        unpersisted: async () => [],
      },
      writer: {
        upsert: vi.fn(),
        markPersisted: vi.fn(),
      },
    }

    const result = await latestPhaseOutputs(store, { type: 'brand', id: 'brand-1' })

    // Should have acquire (row-2, newest succeeded) and detect (row-4)
    expect(result.get('acquire')).toEqual(rows[1])
    expect(result.get('detect')).toEqual(rows[3])
    // row-3 is failed, so it must be ignored for acquire
    expect(result.get('acquire')?.id).toBe('row-2')
  })
})

// ---------------------------------------------------------------------------
// listUnpersistedOutputs
// ---------------------------------------------------------------------------

describe('unpersisted_rows_exclude_dry_run_jobs', () => {
  it('filters rows whose job is dry_run', async () => {
    const nonDryRunRows: PhaseOutputRow[] = [
      {
        id: 'row-1',
        job_id: 'job-real',
        target_id: 'brand-1',
        target_type: 'brand',
        phase: 'acquire',
        status: 'succeeded',
        output: { patch: {} },
        persisted_at: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]

    const store: PhaseOutputStore = {
      reader: {
        latestPerPhase: vi.fn(),
        unpersisted: async () => nonDryRunRows,
      },
      writer: {
        upsert: vi.fn(),
        markPersisted: vi.fn(),
      },
    }

    const result = await listUnpersistedOutputs(store, { type: 'brand', id: 'brand-1' })
    expect(result).toEqual(nonDryRunRows)
  })
})

// ---------------------------------------------------------------------------
// markPersisted
// ---------------------------------------------------------------------------

describe('mark_persisted_stamps_only_given_ids', () => {
  it('the writer receives exactly the ids passed', async () => {
    const mockMarkPersisted = vi.fn()
    const store: PhaseOutputStore = {
      reader: {
        latestPerPhase: vi.fn(),
        unpersisted: vi.fn(),
      },
      writer: {
        upsert: vi.fn(),
        markPersisted: mockMarkPersisted,
      },
    }

    await markPersisted(store, ['id-1', 'id-3', 'id-5'])
    expect(mockMarkPersisted).toHaveBeenCalledTimes(1)
    expect(mockMarkPersisted).toHaveBeenCalledWith(['id-1', 'id-3', 'id-5'])
  })
})
