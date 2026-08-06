import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildImageQueryVariants } from '../scraper/search'
import { preferPatched, runImageSearchPhase } from '../image-search'
import { CLEARED_FIELDS_KEY } from '@/lib/services/brand-write-policy'
import type { BrandImageSearchOutcome } from '../scraper/types'
import type { BatchPhaseContext, EnrichBrand, EnrichPatch, EnrichPhase, SearchPhaseResult } from '../types'

const searchMocks = vi.hoisted(() => ({
  batchSearchBrandImages: vi.fn(),
}))

vi.mock('../scraper/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scraper/search')>()),
  batchSearchBrandImages: searchMocks.batchSearchBrandImages,
}))

const brand: EnrichBrand = {
  id: 'brand-1',
  slug: 'test-brand',
  name: 'Test Brand',
}

function outcome(overrides: Partial<BrandImageSearchOutcome> = {}): BrandImageSearchOutcome {
  return { rows: [], callStatus: 'empty', httpStatus: null, error: null, ...overrides }
}

function serp(overrides: Partial<SearchPhaseResult> = {}): SearchPhaseResult {
  return { urls: [], snippets: [], ...overrides }
}

function ctx(overrides: Partial<BatchPhaseContext> = {}): BatchPhaseContext {
  return {
    chunk: [brand],
    chunkBrandNames: ['Test Brand'],
    phases: ['images'] as EnrichPhase[],
    dryRun: true,
    supabase: null as unknown as BatchPhaseContext['supabase'],
    ...overrides,
  }
}

describe('runImageSearchPhase', () => {
  beforeEach(() => {
    searchMocks.batchSearchBrandImages.mockReset()
    searchMocks.batchSearchBrandImages.mockResolvedValue(new Map())
  })

  it('returns skipped when images is not in requested phases', async () => {
    const result = await runImageSearchPhase(ctx({ phases: ['links'] as EnrichPhase[] }))

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.imageSearchResults.size).toBe(0)
  })

  it('returns skipped when chunk is empty', async () => {
    const result = await runImageSearchPhase(ctx({ chunk: [], chunkBrandNames: [] }))

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.imageSearchResults.size).toBe(0)
  })

  it('skips brands with user-provided hero image', async () => {
    const brandWithImage: EnrichBrand = {
      id: 'brand-with-image',
      slug: 'has-image',
      name: 'Has Image',
      hero_image_url: 'https://example.com/hero.webp',
    }
    const progressMessages: string[] = []
    const result = await runImageSearchPhase(
      ctx({
        chunk: [brandWithImage],
        chunkBrandNames: ['Has Image'],
        onProgress: (msg: string) => progressMessages.push(msg),
      })
    )

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.imageSearchResults.size).toBe(0)
    expect(progressMessages.some((m) => m.includes('Skipping image search'))).toBe(true)
  })

  it('searches submission images when only one active image exists', async () => {
    const submission: EnrichBrand = {
      id: 'submission-1',
      slug: 'has-one-image',
      name: 'Has One Image',
      hero_image_url: 'https://example.com/hero.webp',
    }
    searchMocks.batchSearchBrandImages.mockResolvedValue(new Map([
      ['Has One Image', outcome({
        rows: [{ url: 'https://example.com/additional.webp', query: 'query' }],
        callStatus: 'succeeded',
      })],
    ]))

    const result = await runImageSearchPhase(ctx({
      chunk: [submission],
      chunkBrandNames: ['Has One Image'],
      targetType: 'submission',
      supabase: submissionImagesClient(['submission-1']),
    }))

    expect(searchMocks.batchSearchBrandImages).toHaveBeenCalledOnce()
    // Keyed by target id, not display name: this phase runs after clean/detect,
    // which can rewrite a brand's name.
    expect(result.imageSearchResults.get('submission-1')).toEqual([
      'https://example.com/additional.webp',
    ])
  })

  it('skips submission image search when two active images exist', async () => {
    const submission: EnrichBrand = {
      id: 'submission-1',
      slug: 'has-two-images',
      name: 'Has Two Images',
      hero_image_url: 'https://example.com/hero.webp',
    }

    const result = await runImageSearchPhase(ctx({
      chunk: [submission],
      chunkBrandNames: ['Has Two Images'],
      targetType: 'submission',
      supabase: submissionImagesClient(['submission-1', 'submission-1']),
    }))

    expect(searchMocks.batchSearchBrandImages).not.toHaveBeenCalled()
    expect(result.phaseResult.status).toBe('skipped')
  })

  it('searches anyway when overwrite is set, so a re-run can find better images', async () => {
    const submission: EnrichBrand = {
      id: 'submission-1',
      slug: 'has-two-images',
      name: 'Has Two Images',
      hero_image_url: 'https://example.com/hero.webp',
      overwrite_enrichment: true,
    }

    await runImageSearchPhase(
      ctx({
        chunk: [submission],
        chunkBrandNames: ['Has Two Images'],
        targetType: 'submission',
        supabase: submissionImagesClient(['submission-1', 'submission-1']),
      }),
      new Map([['Has Two Images', serp({ urls: ['https://example.com/a'], snippets: ['a'] })]]),
    )

    expect(searchMocks.batchSearchBrandImages).toHaveBeenCalled()
  })

  it('still honours the no-SERP-results skip even when overwrite is set', async () => {
    const submission: EnrichBrand = {
      id: 'submission-1',
      slug: 'no-serp',
      name: 'No Serp',
      overwrite_enrichment: true,
    }

    const result = await runImageSearchPhase(
      ctx({
        chunk: [submission],
        chunkBrandNames: ['No Serp'],
        targetType: 'submission',
        supabase: submissionImagesClient([]),
      }),
      new Map([['No Serp', serp()]]),
    )

    expect(searchMocks.batchSearchBrandImages).not.toHaveBeenCalled()
    expect(result.phaseResult.status).toBe('skipped')
  })

  // A newly submitted brand has no stored website. This phase now runs AFTER
  // the links phase, so the domain links just discovered reaches the `site:`
  // query on the target's very first enrichment run.
  it('uses the website the links phase just discovered when the stored column is empty', async () => {
    await runImageSearchPhase(
      ctx(),
      new Map([['Test Brand', serp({ urls: ['https://brand.com'], snippets: ['s'] })]]),
      new Map([['brand-1', { purchase_website: 'https://brand.com' }]]),
    )

    const [inputs] = searchMocks.batchSearchBrandImages.mock.calls[0] as [
      Array<{ brandName: string; purchaseWebsite: string | null }>,
    ]
    expect(inputs).toEqual([
      expect.objectContaining({ brandName: 'Test Brand', purchaseWebsite: 'https://brand.com' }),
    ])
  })

  // The links patch is what this run just confirmed by scraping, so it wins
  // over the pre-run snapshot — the same precedence the descriptions phase
  // applies to its `pendingPatch`.
  it('prefers the website this run discovered over the pre-run snapshot', async () => {
    await runImageSearchPhase(
      ctx({
        chunk: [{ ...brand, purchase_website: 'https://stored.com' }],
      }),
      new Map([['Test Brand', serp({ urls: ['https://scraped.com'], snippets: ['s'] })]]),
      new Map([['brand-1', { purchase_website: 'https://scraped.com' }]]),
    )

    const [inputs] = searchMocks.batchSearchBrandImages.mock.calls[0] as [
      Array<{ brandName: string; purchaseWebsite: string | null }>,
    ]
    expect(inputs).toEqual([
      expect.objectContaining({ purchaseWebsite: 'https://scraped.com' }),
    ])
  })

  it('falls back to the stored purchase_website when no phase patched one', async () => {
    await runImageSearchPhase(
      ctx({
        chunk: [{ ...brand, purchase_website: 'https://stored.com' }],
      }),
      new Map([['Test Brand', serp({ urls: ['https://stored.com'], snippets: ['s'] })]]),
      new Map(),
    )

    const [inputs] = searchMocks.batchSearchBrandImages.mock.calls[0] as [
      Array<{ brandName: string; purchaseWebsite: string | null }>,
    ]
    expect(inputs).toEqual([
      expect.objectContaining({ purchaseWebsite: 'https://stored.com' }),
    ])
  })

  // detect and the scraped page title can both improve a name. Because this
  // phase now runs after them, the improvement reaches THIS run's query.
  it('queries with the name an earlier phase corrected, not the pre-run one', async () => {
    await runImageSearchPhase(
      ctx(),
      new Map([['Test Brand', serp({ urls: ['https://brand.com'], snippets: ['s'] })]]),
      new Map([['brand-1', { name: 'Test Brand 測試品牌' }]]),
    )

    const [inputs] = searchMocks.batchSearchBrandImages.mock.calls[0] as [
      Array<{ brandName: string }>,
    ]
    expect(inputs).toEqual([
      expect.objectContaining({ brandName: 'Test Brand 測試品牌' }),
    ])
  })
})

describe('preferPatched', () => {
  it('a revoked column is not resurrected from the stored value', () => {
    const storedValue = 'https://smore.com'
    const clearedPatch = {
      [CLEARED_FIELDS_KEY]: ['purchase_website'],
    } as unknown as EnrichPatch
    const nullPatch = { purchase_website: null } as EnrichPatch

    expect(preferPatched(clearedPatch, storedValue, 'purchase_website')).toBeNull()
    expect(preferPatched(nullPatch, storedValue, 'purchase_website')).toBeNull()
  })

  it('an unrevoked absent column still falls back', () => {
    expect(
      preferPatched({}, '  https://stored.example  ', 'purchase_website'),
    ).toBe('https://stored.example')
  })
})

describe('image query behaviour', () => {
  it('the site: query drops to the no-domain branch', () => {
    const revokedWebsite = preferPatched(
      { [CLEARED_FIELDS_KEY]: ['purchase_website'] } as unknown as EnrichPatch,
      'https://smore.com',
      'purchase_website',
    )

    expect(
      buildImageQueryVariants({ brandName: 'Test Brand', purchaseWebsite: revokedWebsite }),
    ).toEqual(['"Test Brand" 商品'])
  })
})

function submissionImagesClient(submissionIds: string[]): BatchPhaseContext['supabase'] {
  return {
    from: () => ({
      select: () => ({
        in: () => ({
          eq: () => Promise.resolve({
            data: submissionIds.map((submission_id) => ({ submission_id })),
            error: null,
          }),
        }),
      }),
    }),
  } as unknown as BatchPhaseContext['supabase']
}
