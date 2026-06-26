import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runLinksPhase } from '../links'
import type { EnrichBrand, EnrichPhase } from '../types'
import { scrapeBrandUrls } from '../../scraper'

vi.mock('../../scraper', () => ({
  scrapeBrandUrls: vi.fn(),
}))

const brand: EnrichBrand = {
  id: 'brand-1',
  slug: 'test-brand',
  name: 'Test Brand',
  social_instagram: null,
  social_threads: null,
  social_facebook: null,
  purchase_website: null,
  purchase_pinkoi: null,
  purchase_shopee: null,
}

describe('runLinksPhase', () => {
  beforeEach(() => {
    vi.mocked(scrapeBrandUrls).mockReset()
  })

  it('returns skipped when links is not in requested phases', async () => {
    const result = await runLinksPhase({
      brand,
      phases: ['clean'] as EnrichPhase[],
      discoveredUrls: ['https://www.instagram.com/testbrand/'],
      knownUrls: [],
    })

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.patch).toEqual({})
    expect(result.scrapedData).toBeNull()
    expect(scrapeBrandUrls).not.toHaveBeenCalled()
  })

  it('returns succeeded with changedFields when links are enriched', async () => {
    vi.mocked(scrapeBrandUrls).mockResolvedValue({
      data: {
        socialInstagram: 'https://www.instagram.com/testbrand/',
        purchaseWebsite: 'https://testbrand.example',
      },
      statuses: [],
    } as unknown as Awaited<ReturnType<typeof scrapeBrandUrls>>)

    const result = await runLinksPhase({
      brand,
      phases: ['links'] as EnrichPhase[],
      discoveredUrls: ['https://www.instagram.com/testbrand/'],
      knownUrls: ['https://testbrand.example'],
    })

    expect(result.phaseResult.status).toBe('succeeded')
    expect(result.phaseResult.changedFields).toEqual([
      'social_instagram',
      'purchase_website',
    ])
    expect(result.patch).toEqual({
      social_instagram: 'https://www.instagram.com/testbrand/',
      purchase_website: 'https://testbrand.example',
    })
    expect(result.scrapedData).toMatchObject({
      social_instagram: 'https://www.instagram.com/testbrand/',
      purchaseWebsite: 'https://testbrand.example',
    })
  })
})
