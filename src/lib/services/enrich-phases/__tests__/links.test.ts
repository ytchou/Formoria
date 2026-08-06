import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveOfficialWebsite, deriveScrapedBrandName, runLinksPhase } from '../links'
import type { EnrichBrand, EnrichPhase } from '../types'
import { emptyResult } from '../scraper/parse/extractors'

const scraperMocks = vi.hoisted(() => ({ scrapeBrandUrls: vi.fn() }))

vi.mock('../scraper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scraper')>()),
  scrapeBrandUrls: scraperMocks.scrapeBrandUrls,
}))

// This is what decides a brand's `purchase_website`, which the image-search
// phase turns into a `site:` filter — a wrong answer here searches a whole
// platform instead of the brand.
describe('deriveOfficialWebsite', () => {
  it('picks the first non-social, non-marketplace URL and roots it', () => {
    expect(
      deriveOfficialWebsite([
        'https://www.instagram.com/brand',
        'https://shopee.tw/brand',
        'https://brand.com/about/story',
      ]),
    ).toBe('https://brand.com')
  })

  it('returns null when every URL is social or marketplace', () => {
    expect(
      deriveOfficialWebsite(['https://www.instagram.com/brand', 'https://www.pinkoi.com/store/brand']),
    ).toBeNull()
  })

  it('returns null for no URLs', () => {
    expect(deriveOfficialWebsite([])).toBeNull()
  })

  // Aggregators classify as null on purpose (so the scraper harvests them),
  // which used to make them eligible to become the brand's own website.
  it('skips a link aggregator in favour of the real brand domain', () => {
    expect(deriveOfficialWebsite(['https://linktr.ee/brand', 'https://brand.com/about'])).toBe(
      'https://brand.com',
    )
  })

  it('returns null when a link aggregator is the only candidate', () => {
    expect(deriveOfficialWebsite(['https://lit.link/brand'])).toBeNull()
  })

  it('never returns a Threads URL, on either host', () => {
    expect(deriveOfficialWebsite(['https://www.threads.com/@brand'])).toBeNull()
    expect(deriveOfficialWebsite(['https://www.threads.net/@brand'])).toBeNull()
  })

  // A live run made `https://www.ubereats.com` a tea brand's official website.
  it('skips a delivery platform in favour of the brand domain', () => {
    expect(
      deriveOfficialWebsite(
        ['https://www.ubereats.com/tw/store/cha-tzu-tang', 'https://www.chatzutang.com/products'],
        'Cha Tzu Tang',
      ),
    ).toBe('https://www.chatzutang.com')
  })

  it('prefers the candidate whose domain carries a brand-name token', () => {
    expect(
      deriveOfficialWebsite(
        ['https://www.taipeifoodguide.com/posts/chatzutang', 'https://www.chatzutang.com/'],
        'Cha Tzu Tang 茶籽堂',
      ),
    ).toBe('https://www.chatzutang.com')
  })

  it('keeps first-eligible behaviour when no brand name is given', () => {
    expect(
      deriveOfficialWebsite([
        'https://www.taipeifoodguide.com/posts/chatzutang',
        'https://www.chatzutang.com/',
      ]),
    ).toBe('https://www.taipeifoodguide.com')
  })

  // A purely Han name yields no Latin tokens, so there is nothing to
  // discriminate with and first-eligible remains the only available answer.
  it('falls back to first-eligible for a name with no Latin tokens', () => {
    expect(
      deriveOfficialWebsite(['https://www.some-shop.tw/about', 'https://www.other.tw/'], '茶籽堂'),
    ).toBe('https://www.some-shop.tw')
  })

  // Both from one live run. First-eligible is what adopted another company's
  // site as the brand's own; with usable tokens, no match means no website.
  it('returns null when the name has tokens and no domain carries one', () => {
    expect(
      deriveOfficialWebsite(['https://www.nahoku.com/collections/rings'], 'NU Dream Jewelry'),
    ).toBeNull()
  })

  it('deriveOfficialWebsite — unchanged after helper move', () => {
    expect(deriveOfficialWebsite(['https://onewood.dk'], 'One Wood')).toBeNull()
    expect(deriveOfficialWebsite(['https://nahoku.com'], 'NU Dream Jewelry')).toBeNull()
    expect(
      deriveOfficialWebsite(['https://myship.7-11.com.tw/general/detail/GM123'], '原形東方茶飲 pur Sweets'),
    ).toBeNull()
  })

  // A Taiwan-only directory. `https://onewood.dk` — a Danish company sharing the
  // name — became the brand "One Wood"'s official website on a live run, and it
  // passed the token check precisely because the two companies share a name.
  it('rejects a foreign ccTLD even when the domain carries the brand tokens', () => {
    expect(deriveOfficialWebsite(['https://onewood.dk'], 'One Wood')).toBeNull()
    expect(
      deriveOfficialWebsite(['https://www.paperdiamond.uk/shop'], 'Paper Diamond'),
    ).toBeNull()
  })

  // The fallback path takes first-eligible, so the guard has to sit in the
  // filter rather than beside the token match.
  it('rejects a foreign ccTLD on the no-token fallback path too', () => {
    expect(deriveOfficialWebsite(['https://onewood.dk'], '木一')).toBeNull()
    expect(deriveOfficialWebsite(['https://onewood.dk'])).toBeNull()
  })

  it('keeps generic and Taiwanese TLDs', () => {
    expect(deriveOfficialWebsite(['https://moonlight22.com'], '沐籟 Moonlight')).toBe(
      'https://moonlight22.com',
    )
    expect(deriveOfficialWebsite(['https://su3.bonmipang.com/products'], 'Su3')).toBe(
      'https://su3.bonmipang.com',
    )
    expect(deriveOfficialWebsite(['https://taiwandye.com/about'], 'Taiwan Dye')).toBe(
      'https://taiwandye.com',
    )
    expect(deriveOfficialWebsite(['https://www.chatzutang.com.tw/'], 'Cha Tzu Tang')).toBe(
      'https://www.chatzutang.com.tw',
    )
  })

  it('never adopts a convenience-store logistics host as the brand site', () => {
    expect(
      deriveOfficialWebsite(['https://myship.7-11.com.tw/general/detail/GM123'], '原形東方茶飲 pur Sweets'),
    ).toBeNull()
  })
})

describe('deriveScrapedBrandName', () => {
  const derive = (name: string, brandName: string | null): string | null =>
    deriveScrapedBrandName({ name }, { brandName })

  // The case this exists for: adela.tw's title carries the Chinese name the
  // record is missing, and the scraper has always extracted it.
  it('grows a Latin-only record into the bilingual name from the page title', () => {
    expect(derive('ADELA', 'adela愛德拉 ｜守護家人，為愛研發')).toBe('Adela 愛德拉')
  })

  it('accepts a title that only needs cleaning', () => {
    expect(derive('ADELA', 'Adela愛德拉')).toBe('Adela 愛德拉')
  })

  it('refuses a title naming a different company', () => {
    expect(derive('ADELA', '德瑪貝爾化粧品')).toBeNull()
  })

  it('refuses SEO copy even when it contains the brand', () => {
    expect(derive('ADELA', 'ADELA 推薦 必買 伴手禮')).toBeNull()
  })

  it('refuses a title that drops part of the existing name', () => {
    expect(derive('Adela 愛德拉', 'Adela')).toBeNull()
  })

  it('is a no-op when the cleaned title matches what is stored', () => {
    expect(derive('Adela 愛德拉', 'Adela 愛德拉')).toBeNull()
  })

  it('is a no-op when the scraper found no name', () => {
    expect(derive('ADELA', null)).toBeNull()
    expect(derive('ADELA', '   ')).toBeNull()
  })
})

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
    // The scraped title is a candidate for the names phase, never a patch key.
    expect(result.scrapedBrandName).toBeNull()
    expect(result.scrapedData).toBeNull()
  })

  it('returns empty jsonLdImageUrls when links phase is skipped', async () => {
    const result = await runLinksPhase({
      brand,
      phases: ['clean'] as EnrichPhase[],
      discoveredUrls: [],
      knownUrls: [],
    })
    expect(result.jsonLdImageUrls).toEqual([])
  })
})

describe('links quarantine identity rules', () => {
  beforeEach(() => {
    scraperMocks.scrapeBrandUrls.mockReset()
  })

  const scrape = (
    sourceUrl: string,
    data: Partial<ReturnType<typeof emptyResult>>,
  ) => ({
    data: {
      ...emptyResult(sourceUrl),
      ...data,
      linkProvenance: Object.fromEntries(
        Object.entries(data)
          .filter(([field, value]) => field !== 'brandName' && typeof value === 'string')
          .map(([field]) => [field, { sourceUrl }]),
      ),
      textProvenance: Object.fromEntries(
        Object.entries(data)
          .filter(([field, value]) => ['brandName', 'description', 'story'].includes(field) && typeof value === 'string')
          .map(([field]) => [field, { sourceUrl }]),
      ),
      textSourceUrl: sourceUrl,
    },
    statuses: [],
  })

  const run = async (overrides: Partial<Parameters<typeof runLinksPhase>[0]>) =>
    runLinksPhase({
      brand,
      phases: ['links'] as EnrichPhase[],
      discoveredUrls: [],
      knownUrls: [],
      ...overrides,
    })

  it('a known-url source page is confirmed', () => {
    scraperMocks.scrapeBrandUrls.mockResolvedValue(
      scrape('https://dtbbag.com/about', {
        socialFacebook: 'https://www.facebook.com/stranger',
      }),
    )

    return run({ knownUrls: ['https://dtbbag.com/about'] }).then((result) => {
      expect(result.patch.social_facebook).toBe('https://www.facebook.com/stranger')
      expect(result.quarantine).toEqual({})
    })
  })

  it('a SERP source page failing the predicate quarantines its links', () => {
    // `purchasePinkoi` is deliberately NOT in DEV-1332's IDENTITY_GATED_FIELDS —
    // marketplace handles are routinely opaque IDs, so a handle test there would
    // reject legitimate store links. That makes it the field where the ladder's
    // own source-page rule is the only thing standing between a stranger's page
    // and the column, which is exactly what this case must cover.
    scraperMocks.scrapeBrandUrls.mockResolvedValue(
      scrape('https://stranger.example/page', {
        purchasePinkoi: 'https://www.pinkoi.com/store/other-company',
      }),
    )

    return run({
      brand: { ...brand, name: 'Han Brand' },
      discoveredUrls: ['https://stranger.example/page'],
    }).then((result) => {
      expect(result.patch.purchase_pinkoi).toBe('https://www.pinkoi.com/store/other-company')
      expect(result.quarantine['https://stranger.example/page']).toMatchObject({
        columns: ['purchase_pinkoi'],
        subjectKind: 'source-page',
      })
    })
  })

  it('a social handle the DEV-1332 gate declined is not quarantined', () => {
    // The handle gate drops a stranger's social before it reaches the patch. It
    // must NOT then be escalated: a verdict about a page this run took no value
    // from could otherwise clear the brand's stored handle via `_cleared_fields`.
    scraperMocks.scrapeBrandUrls.mockResolvedValue(
      scrape('https://stranger.example/page', {
        socialFacebook: 'https://www.facebook.com/other-company',
      }),
    )

    return run({
      brand: { ...brand, name: 'Han Brand' },
      discoveredUrls: ['https://stranger.example/page'],
    }).then((result) => {
      expect(result.patch.social_facebook).toBeUndefined()
      expect(result.quarantine).toEqual({})
    })
  })

  it('a SERP source page passing the predicate does not quarantine', () => {
    scraperMocks.scrapeBrandUrls.mockResolvedValue(
      scrape('https://han.example/page', {
        socialFacebook: 'https://www.facebook.com/han-brand',
      }),
    )

    return run({
      brand: { ...brand, name: 'Han Brand' },
      discoveredUrls: ['https://han.example/page'],
    }).then((result) => expect(result.quarantine).toEqual({}))
  })

  it('an unconfirmed candidate website is quarantined', () => {
    scraperMocks.scrapeBrandUrls.mockResolvedValue(scrape('https://some-shop.tw', {}))

    return run({
      brand: { ...brand, name: '茶籽堂' },
      discoveredUrls: ['https://some-shop.tw/about'],
    }).then((result) => {
      expect(result.patch.purchase_website).toBe('https://some-shop.tw')
      expect(result.quarantine['https://some-shop.tw']).toMatchObject({
        subjectKind: 'website',
      })
    })
  })

  it("second-pass links inherit their source's quarantine", async () => {
    // Carried on `purchasePinkoi` rather than a social: DEV-1332's handle gate
    // would drop a stranger's social handle before the patch, leaving nothing to
    // inherit and making the case untestable on that field.
    scraperMocks.scrapeBrandUrls
      .mockResolvedValueOnce(
        scrape('https://brand.example', {
          socialInstagram: 'https://www.instagram.com/stranger',
        }),
      )
      .mockResolvedValueOnce(
        scrape('https://www.instagram.com/stranger', {
          purchasePinkoi: 'https://www.pinkoi.com/store/stranger',
        }),
      )

    const result = await run({
      brand: { ...brand, name: 'Han Brand' },
      discoveredUrls: ['https://brand.example'],
    })

    expect(result.patch.purchase_pinkoi).toBe('https://www.pinkoi.com/store/stranger')
    expect(result.quarantine['https://www.instagram.com/stranger']).toMatchObject({
      columns: ['purchase_pinkoi'],
    })
  })

  it('quarantine covers purchase_myship', () => {
    scraperMocks.scrapeBrandUrls.mockResolvedValue(
      scrape('https://stranger.example/page', {
        purchaseMyship: 'https://myship.example/order/123',
      }),
    )

    return run({
      brand: { ...brand, name: 'Han Brand' },
      discoveredUrls: ['https://stranger.example/page'],
    }).then((result) => {
      expect(result.patch.purchase_myship).toBe('https://myship.example/order/123')
      expect(result.quarantine['https://stranger.example/page'].columns).toContain('purchase_myship')
    })
  })

  it('second-pass re-merge preserves provenance and emits evidence', async () => {
    scraperMocks.scrapeBrandUrls
      .mockResolvedValueOnce(
        scrape('https://brand.example', {
          socialInstagram: 'https://www.instagram.com/stranger',
        }),
      )
      .mockResolvedValueOnce(
        scrape('https://www.instagram.com/stranger', {
          brandName: 'Stranger Brand',
          description: 'Description from the stranger page',
          purchasePinkoi: 'https://www.pinkoi.com/store/stranger',
        }),
      )

    const result = await run({
      brand: { ...brand, name: 'Han Brand' },
      discoveredUrls: ['https://brand.example'],
    })

    // The guard this case exists for: before DEV-1309's re-merge fix, the
    // second pass rebuilt the merge from scratch and dropped both provenance
    // maps, so every quarantine got empty evidence and the site_identity phase
    // skipped every group — the feature was inert while the suite stayed green.
    expect(result.scrapedData?.linkProvenance?.purchasePinkoi?.sourceUrl).toBe(
      'https://www.instagram.com/stranger',
    )
    expect(result.scrapedData?.textProvenance?.description?.sourceUrl).toBe(
      'https://www.instagram.com/stranger',
    )
    expect(result.quarantine['https://www.instagram.com/stranger'].evidence).toEqual({
      title: 'Stranger Brand',
      description: 'Description from the stranger page',
    })
  })
})
