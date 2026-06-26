import { describe, expect, it } from 'vitest'
import { runDescriptionsPhase } from '../descriptions'
import type { EnrichBrand, EnrichPhase } from '../types'

const brand: EnrichBrand = {
  id: 'brand-1',
  slug: 'test-brand',
  name: 'Test Brand',
  description: null,
  brand_highlights: null,
}

describe('runDescriptionsPhase', () => {
  it('returns skipped when descriptions is not in requested phases', async () => {
    const result = await runDescriptionsPhase({
      brand,
      phases: ['links'] as EnrichPhase[],
      scrapedData: {
        description: 'A long enough brand description from scraped data.',
      },
      serpSnippets: ['Snippet'],
    })

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.patch).toEqual({})
  })

  it('returns skipped when no scraped data and no snippets available', async () => {
    const result = await runDescriptionsPhase({
      brand,
      phases: ['descriptions'] as EnrichPhase[],
      scrapedData: null,
      serpSnippets: [],
    })

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.phaseResult.detail).toContain('no description')
    expect(result.patch).toEqual({})
  })
})
