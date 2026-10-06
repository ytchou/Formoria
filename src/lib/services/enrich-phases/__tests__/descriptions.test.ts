import { describe, expect, it } from 'vitest'
import { buildEnrichmentUserContent } from '../../description-rewrite'
import { CLEARED_FIELDS_KEY } from '@/lib/services/brand-write-policy'
import {
  buildDescriptionEvidence,
  buildFoundingFactSources,
  effectiveOwnedSiteHosts,
  loadPersistedScrapeStructure,
  preferPatched,
  projectPersistedScrapeRows,
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

describe('buildFoundingFactSources', () => {
  it('keeps source text addressable and classifies known brand links as first-party', () => {
    const result = buildFoundingFactSources(
      {
        'https://official.example/about': {
          title: 'About',
          story: 'Founded in Taipei in 2019.',
        },
        'https://design-journal.example/interview': {
          title: 'Interview',
          description: 'The studio began in Taipei.',
        },
      },
      {
        links: {
          purchaseWebsite: 'https://official.example',
          socialInstagram: null,
          socialThreads: null,
          socialFacebook: null,
          purchasePinkoi: null,
          purchaseShopee: null,
          purchaseMyship: null,
        },
        productCategoryZh: null,
        imageAlts: [],
      },
    )

    expect(result).toEqual([
      expect.objectContaining({
        url: 'https://official.example/about',
        sourceType: 'first-party',
        fetched: true,
        text: expect.stringContaining('Founded in Taipei in 2019.'),
      }),
      expect.objectContaining({
        url: 'https://design-journal.example/interview',
        sourceType: 'independent',
      }),
    ])
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

// Review BS1: the read-time allow-list follows this run's purchase_website.
describe('effectiveOwnedSiteHosts', () => {
  const site = { ...brand, purchase_website: 'https://brand.com' }

  it('excludes a purchase_website this run revoked via _cleared_fields', () => {
    expect(
      effectiveOwnedSiteHosts(site, {
        [CLEARED_FIELDS_KEY]: ['purchase_website'],
      } as unknown as EnrichPatch),
    ).toEqual(new Set())
  })

  it('excludes a purchase_website this run revoked with an explicit null', () => {
    expect(effectiveOwnedSiteHosts(site, { purchase_website: null })).toEqual(
      new Set(),
    )
  })

  it('uses a purchase_website this run patched', () => {
    expect(
      effectiveOwnedSiteHosts(site, { purchase_website: 'https://www.new.com' }),
    ).toEqual(new Set(['new.com']))
  })

  it('falls back to the stored purchase_website with no patch', () => {
    expect(effectiveOwnedSiteHosts(site, undefined)).toEqual(
      new Set(['brand.com']),
    )
  })
})

// ---------------------------------------------------------------------------
// projectPersistedScrapeRows — read-time stockist ownership guard (DEV-1943)
// ---------------------------------------------------------------------------

describe('projectPersistedScrapeRows', () => {
  const owned = new Set(['brand.com'])
  // The shape `acquire` writes: the extracted fields spread onto raw_response.
  const scrapeRow = (url: string, stockistPageText: string) => ({
    urls: [url],
    snippets: [],
    raw_response: { url, classification: 'official-site', stockistPageText },
    call_status: 'succeeded',
  })

  it('drops stockist text persisted from a host the brand does not own', () => {
    const result = projectPersistedScrapeRows(
      [scrapeRow('https://mall.example/stores', '寶雅 屈臣氏 Costco')],
      owned,
    )
    expect(result.siteContent ?? '').not.toContain('Stockist Page:')
    expect(result.siteContent ?? '').not.toContain('寶雅')
  })

  it('keeps stockist text persisted from the brand own site', () => {
    const result = projectPersistedScrapeRows(
      [scrapeRow('https://brand.com/stores', '誠品書店 信義店')],
      owned,
    )
    expect(result.siteContent).toContain('Stockist Page: 誠品書店 信義店')
  })

  it('fails closed when the brand owns no site host', () => {
    const result = projectPersistedScrapeRows(
      [scrapeRow('https://brand.com/stores', '誠品書店 信義店')],
      new Set(),
    )
    expect(result.siteContent ?? '').not.toContain('Stockist Page:')
  })

  // Legacy rows: acquire's boundedScrapeSnippets copied stockistPageText into
  // the snippets column, so the guard must strip that copy too (review B1).
  const legacyRow = (url: string, snippets: string[], stockistPageText: string) => ({
    ...scrapeRow(url, stockistPageText),
    snippets,
  })

  it('drops the snippets copy of stockist text from a host the brand does not own', () => {
    const venueText = '寶雅 屈臣氏 Costco'
    const result = projectPersistedScrapeRows(
      [legacyRow('https://mall.example/stores', ['品牌介紹', venueText], venueText)],
      owned,
    )
    expect(result.snippets).toEqual(['品牌介紹'])
  })

  it('drops the 4000-char bounded snippets copy of a long non-owned stockist text', () => {
    const venueText = `  ${'寶雅 '.repeat(2_000)}`
    const result = projectPersistedScrapeRows(
      [legacyRow('https://mall.example/stores', ['品牌介紹', venueText.slice(0, 4_000)], venueText)],
      owned,
    )
    expect(result.snippets).toEqual(['品牌介紹'])
  })

  it('keeps the snippets copy of stockist text from the brand own site', () => {
    const venueText = '誠品書店 信義店'
    const result = projectPersistedScrapeRows(
      [legacyRow('https://brand.com/stores', ['品牌介紹', venueText], venueText)],
      owned,
    )
    expect(result.snippets).toEqual(['品牌介紹', venueText])
  })
})
