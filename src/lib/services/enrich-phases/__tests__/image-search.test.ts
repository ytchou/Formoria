import { describe, expect, it } from 'vitest'
import { runImageSearchPhase } from '../image-search'
import type { BatchPhaseContext, EnrichBrand, EnrichPhase } from '../types'

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

  it('skips brands with user-provided product photos', async () => {
    const brandWithPhotos: EnrichBrand = {
      id: 'brand-with-photos',
      slug: 'has-photos',
      name: 'Has Photos',
      product_photos: ['https://example.com/photo1.webp'],
    }
    const result = await runImageSearchPhase(
      ctx({
        chunk: [brandWithPhotos],
        chunkBrandNames: ['Has Photos'],
      })
    )

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.imageSearchResults.size).toBe(0)
  })
})
