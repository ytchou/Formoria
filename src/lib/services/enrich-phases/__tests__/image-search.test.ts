import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runImageSearchPhase } from '../image-search'
import type { BatchPhaseContext, EnrichBrand, EnrichPhase } from '../types'

const searchMocks = vi.hoisted(() => ({
  batchSearchBrandImages: vi.fn(),
}))

vi.mock('../scraper/search', () => ({
  batchSearchBrandImages: searchMocks.batchSearchBrandImages,
}))

const brand: EnrichBrand = {
  id: 'brand-1',
  slug: 'test-brand',
  name: 'Test Brand',
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
      ['Has One Image', [{ url: 'https://example.com/additional.webp', query: 'query' }]],
    ]))

    const result = await runImageSearchPhase(ctx({
      chunk: [submission],
      chunkBrandNames: ['Has One Image'],
      targetType: 'submission',
      supabase: submissionImagesClient(['submission-1']),
    }))

    expect(searchMocks.batchSearchBrandImages).toHaveBeenCalledOnce()
    expect(result.imageSearchResults.get('Has One Image')).toEqual([
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
