import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { runEnrich } from '../curation-operations'
import type { DetectResult } from '../product-type-classifier'
import type { ImageQueryInput } from '../enrich-phases/scraper/types'

/**
 * The enrichment chunk runs as two per-brand waves with ONE batched serper
 * image call between them:
 *
 *   discover -> detect -> [wave A: detect application, clean, links]
 *            -> image search (batched) -> [wave B: images ... persist]
 *
 * These tests pin the two properties that ordering buys and that no phase-level
 * test can see: a target rejected in wave A never reaches the paid image call,
 * and the image query uses the website the links phase found in the same run.
 *
 * Lives in its own file because the module mocks below would otherwise apply to
 * the DB-backed suites in `curation-operations.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  detectBrandsBatch: vi.fn(),
  batchSearchBrandImages: vi.fn(),
  scrapeBrandUrls: vi.fn(),
  getLatestSearchResults: vi.fn(),
}))

vi.mock('../product-type-classifier', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../product-type-classifier')>()),
  detectBrandsBatch: mocks.detectBrandsBatch,
}))

vi.mock('../enrich-phases/scraper/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../enrich-phases/scraper/search')>()),
  batchSearchBrandImages: mocks.batchSearchBrandImages,
}))

vi.mock('../enrich-phases/scraper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../enrich-phases/scraper')>()),
  scrapeBrandUrls: mocks.scrapeBrandUrls,
}))

vi.mock('../search-results', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../search-results')>()),
  getLatestSearchResults: mocks.getLatestSearchResults,
  startSearchAudit: vi.fn(async () => 'audit-1'),
  finishSearchAudit: vi.fn(async () => undefined),
}))

type SubmissionRow = {
  id: string
  brand_name: string
  status: string
  brand_id: string | null
  social_instagram: string | null
  purchase_website: string | null
  [key: string]: unknown
}

function submission(overrides: Partial<SubmissionRow> & { id: string }): SubmissionRow {
  return {
    brand_name: `Brand ${overrides.id}`,
    status: 'pending',
    brand_id: null,
    description: null,
    website_url: null,
    hero_image_url: null,
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
    purchase_website: null,
    purchase_pinkoi: null,
    purchase_shopee: null,
    other_urls: [],
    enriched_data: null,
    owner_data: null,
    base_brand_data: null,
    intent: 'recommend',
    ...overrides,
  }
}

/**
 * Only two chains are exercised: the submission fetch in `runEnrich` and the
 * active-image count in the image-search phase. Both terminate in an awaited
 * thenable, so the builder is a self-returning proxy with a fixed payload.
 */
function fakeSupabase(submissions: SubmissionRow[]): SupabaseClient {
  const builder = (rows: unknown[]): Record<string, unknown> => {
    const chain: Record<string, unknown> = {
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    }
    for (const method of ['select', 'eq', 'is', 'in', 'limit', 'update', 'single']) {
      chain[method] = () => chain
    }
    return chain
  }

  return {
    from: (table: string) =>
      builder(table === 'brand_submissions' ? submissions : []),
  } as unknown as SupabaseClient
}

function detectResult(overrides: Partial<DetectResult> & { slug: string }): DetectResult {
  return {
    isNonBrand: false,
    nonBrandReason: null,
    brandName: null,
    slugGenerated: null,
    productType: null,
    confidence: 'high',
    ...overrides,
  } as DetectResult
}

/**
 * `scrapeBrandUrls` always resolves a COMPLETE `ScrapedBrandData` in production
 * — every strategy returns a spread of `emptyResult(url)`. Mocking a partial
 * object makes the merge path throw on fields it is entitled to assume exist,
 * which is a defect in the fixture, not in the code under test.
 */
function scrapeResult(data: Record<string, unknown> = {}) {
  return {
    data: {
      brandName: null,
      description: null,
      story: null,
      heroImageUrl: null,
      websiteUrl: null,
      stockistPageText: null,
      galleryImageUrls: [],
      imageSources: [],
      jsonLdImageUrls: [],
      rawJsonLd: [],
      categoryHints: [],
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
      purchaseWebsite: null,
      purchasePinkoi: null,
      purchaseShopee: null,
      ...data,
    },
    statuses: [],
  }
}

function imageQueryInputs(): ImageQueryInput[] {
  const call = mocks.batchSearchBrandImages.mock.calls[0]
  return (call?.[0] ?? []) as ImageQueryInput[]
}

// detect + links + images: enough to exercise both waves and the batched image
// call, without pulling any LLM description phase into the run.
const PHASES = ['detect', 'links', 'images']

describe('runEnrich two-wave ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLatestSearchResults.mockResolvedValue(new Map())
    mocks.batchSearchBrandImages.mockResolvedValue(new Map())
    mocks.scrapeBrandUrls.mockResolvedValue(scrapeResult())
  })

  it('does not spend an image search on a brand wave A rejected as a non-brand', async () => {
    const rejected = submission({
      id: 'sub-nonbrand',
      brand_name: 'Reseller Shop',
      social_instagram: 'https://www.instagram.com/reseller',
    })
    const kept = submission({
      id: 'sub-brand',
      brand_name: 'Real Brand',
      social_instagram: 'https://www.instagram.com/realbrand',
    })
    mocks.detectBrandsBatch.mockResolvedValue(
      new Map([
        [
          `submission-${rejected.id}`,
          detectResult({
            slug: `submission-${rejected.id}`,
            isNonBrand: true,
            nonBrandReason: 'reseller',
            confidence: 'high',
          }),
        ],
        [`submission-${kept.id}`, detectResult({ slug: `submission-${kept.id}` })],
      ]),
    )

    const result = await runEnrich(
      {
        target: 'submissions',
        submissionIds: [rejected.id, kept.id],
        dryRun: true,
        phases: PHASES,
        onProgress: () => {},
      },
      fakeSupabase([rejected, kept]),
    )

    // The whole point of the reorder: the paid call sees only the survivor.
    expect(mocks.batchSearchBrandImages).toHaveBeenCalledOnce()
    expect(imageQueryInputs().map((input) => input.brandName)).toEqual(['Real Brand'])

    // ...and the rejected target is recorded exactly once, by wave A.
    expect(result.processed).toBe(2)
    expect(result.brandOutcomes).toHaveLength(2)
    expect(result.brandOutcomes.filter(Boolean)).toHaveLength(2)
    expect(result.skipped + result.updated).toBe(2)
    expect(
      result.brandOutcomes.find((outcome) => outcome.submissionId === rejected.id),
    ).toMatchObject({
      status: 'skipped',
      error: 'Detection classified this entry as not a brand: reseller',
    })
  })

  it('never runs the links phase for a brand wave A rejected as a non-brand', async () => {
    const rejected = submission({
      id: 'sub-nonbrand',
      social_instagram: 'https://www.instagram.com/reseller',
    })
    mocks.detectBrandsBatch.mockResolvedValue(
      new Map([
        [
          `submission-${rejected.id}`,
          detectResult({
            slug: `submission-${rejected.id}`,
            isNonBrand: true,
            nonBrandReason: 'reseller',
            confidence: 'high',
          }),
        ],
      ]),
    )

    await runEnrich(
      {
        target: 'submissions',
        submissionIds: [rejected.id],
        dryRun: true,
        phases: PHASES,
        onProgress: () => {},
      },
      fakeSupabase([rejected]),
    )

    expect(mocks.scrapeBrandUrls).not.toHaveBeenCalled()
    expect(mocks.batchSearchBrandImages).not.toHaveBeenCalled()
  })

  it('queries images with the website the links phase discovered in the same run', async () => {
    const target = submission({
      id: 'sub-brand',
      brand_name: 'Discovered Site Brand',
      // The only URL on the record; scraping it is how the brand's own domain
      // is learned, which used to be one enrichment run too late.
      social_instagram: 'https://www.instagram.com/discoveredsite',
    })
    mocks.detectBrandsBatch.mockResolvedValue(
      new Map([[`submission-${target.id}`, detectResult({ slug: `submission-${target.id}` })]]),
    )
    mocks.scrapeBrandUrls.mockResolvedValue(
      scrapeResult({ purchaseWebsite: 'https://discovered.example.com' }),
    )

    await runEnrich(
      {
        target: 'submissions',
        submissionIds: [target.id],
        dryRun: true,
        phases: PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    )

    expect(mocks.scrapeBrandUrls).toHaveBeenCalled()
    expect(imageQueryInputs()).toEqual([
      expect.objectContaining({
        brandName: 'Discovered Site Brand',
        purchaseWebsite: 'https://discovered.example.com',
      }),
    ])
  })

  it('falls back to the stored website when links discovers nothing', async () => {
    const target = submission({
      id: 'sub-brand',
      brand_name: 'Stored Site Brand',
      purchase_website: 'https://stored.example.com',
    })
    mocks.detectBrandsBatch.mockResolvedValue(
      new Map([[`submission-${target.id}`, detectResult({ slug: `submission-${target.id}` })]]),
    )

    await runEnrich(
      {
        target: 'submissions',
        submissionIds: [target.id],
        dryRun: true,
        phases: PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    )

    expect(imageQueryInputs()).toEqual([
      expect.objectContaining({ purchaseWebsite: 'https://stored.example.com' }),
    ])
  })
})
