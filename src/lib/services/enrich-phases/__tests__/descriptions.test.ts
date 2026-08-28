import { describe, expect, it } from 'vitest'
import { buildEnrichmentUserContent } from '../../description-rewrite'
import { CLEARED_FIELDS_KEY } from '@/lib/services/brand-write-policy'
import {
  buildDescriptionEvidence,
  loadPersistedScrapeStructure,
  preferPatched,
} from '../descriptions'
import type { EnrichBrand, EnrichPatch } from '../types'

const brand: EnrichBrand = {
  id: 'brand-1',
  slug: 'test-brand',
  name: 'Test Brand',
  purchase_website: 'https://smore.com',
  social_instagram: 'https://instagram.com/test-brand',
  purchase_shopee: 'https://shopee.tw/test-brand',
}

describe('preferPatched', () => {
  it('a revoked column is not resurrected from the stored value', () => {
    expect(
      preferPatched(
        { [CLEARED_FIELDS_KEY]: ['purchase_website'] } as unknown as EnrichPatch,
        'https://smore.com',
        'purchase_website',
      ),
    ).toBeNull()
  })

  it('an unrevoked absent column still falls back', () => {
    expect(
      preferPatched({}, '  https://stored.example  ', 'purchase_website'),
    ).toBe('https://stored.example')
  })
})

describe('description prompt behaviour', () => {
  it('the description prompt omits the revoked link', () => {
    const evidence = buildDescriptionEvidence(
      brand,
      { [CLEARED_FIELDS_KEY]: ['purchase_website'] } as unknown as EnrichPatch,
      [],
    )
    const { userContent } = buildEnrichmentUserContent(
      brand.name ?? '',
      null,
      [],
      null,
      evidence,
    )

    expect(userContent).not.toContain('smore.com')
    expect(userContent).toContain('instagram.com/test-brand')
    expect(userContent).toContain('shopee.tw/test-brand')
  })
})

// ---------------------------------------------------------------------------
// loadPersistedScrapeStructure — Task 4 (DEV-1610)
// ---------------------------------------------------------------------------

/** Minimal Supabase client double that resolves a canned query. */
function makeClientDouble(rows: Record<string, unknown>[]) {
  return {
    from: () => ({
      select: () => ({
        eq: function (this: unknown) { return this },
        order: function (this: unknown) { return this },
        limit: () => ({ data: rows, error: null }),
      }),
    }),
  }
}

describe('loadPersistedScrapeStructure', () => {
  it('rebuilds_per_source_text_from_persisted_rows', async () => {
    const rows = [
      {
        urls: ['https://example.com/about'],
        raw_response: {
          url: 'https://example.com/about',
          extracted: {
            title: 'About Us',
            description: 'We make things.',
            story: 'Founded in 2020.',
          },
        },
        call_status: 'succeeded',
      },
    ]
    const result = await loadPersistedScrapeStructure(
      'brand-1',
      makeClientDouble(rows) as never,
    )
    expect(result).toEqual({
      'https://example.com/about': {
        title: 'About Us',
        description: 'We make things.',
        story: 'Founded in 2020.',
      },
    })
  })

  it('skips_failed_scrape_rows', async () => {
    const rows = [
      {
        urls: ['https://example.com/page'],
        raw_response: {
          url: 'https://example.com/page',
          extracted: {
            title: 'Page',
            description: 'Desc',
            story: null,
          },
        },
        call_status: 'failed',
      },
    ]
    const result = await loadPersistedScrapeStructure(
      'brand-1',
      makeClientDouble(rows) as never,
    )
    expect(result).toEqual({})
  })

  it('returns_empty_when_no_scrape_rows', async () => {
    const result = await loadPersistedScrapeStructure(
      'brand-1',
      makeClientDouble([]) as never,
    )
    expect(result).toEqual({})
  })
})
