import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runBrandImagePhase } from '../images'
import type { EnrichBrand, EnrichPhase } from '../types'
import { downloadAndStoreImages } from '../../image-download'

vi.mock('../../image-download', () => ({
  downloadAndStoreImages: vi.fn(),
}))

const brand: EnrichBrand = {
  id: 'brand-1',
  slug: 'test-brand',
  name: 'Test Brand',
  hero_image_url: null,
}

describe('runBrandImagePhase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns skipped when images is not in requested phases', async () => {
    const result = await runBrandImagePhase({
      brand,
      phases: ['links'] as EnrichPhase[],
      imageSearchUrls: ['https://example.com/image.jpg'],
    })

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.patch).toEqual({})
  })

  it('returns skipped when no image URLs available', async () => {
    const result = await runBrandImagePhase({
      brand,
      phases: ['images'] as EnrichPhase[],
      imageSearchUrls: [],
    })

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.phaseResult.detail).toContain('no image')
    expect(result.patch).toEqual({})
  })

  it('stores submission enrichment images against the submission target', async () => {
    vi.mocked(downloadAndStoreImages).mockResolvedValue([
      'https://example.com/stored.jpg',
    ])

    await runBrandImagePhase({
      brand,
      phases: ['images'] as EnrichPhase[],
      imageSearchUrls: ['https://example.com/image.jpg'],
      target: { type: 'submission', id: 'submission-1' },
    })

    expect(downloadAndStoreImages).toHaveBeenCalledWith(
      ['https://example.com/image.jpg'],
      { type: 'submission', id: 'submission-1' },
    )
  })
})
