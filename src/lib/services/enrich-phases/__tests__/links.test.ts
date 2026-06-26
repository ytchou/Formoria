import { describe, expect, it } from 'vitest'
import { runLinksPhase } from '../links'
import type { EnrichBrand, EnrichPhase } from '../types'

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
  })
})
