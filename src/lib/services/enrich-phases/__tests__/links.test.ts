import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deriveOfficialNameCandidates,
  deriveOfficialWebsite,
  deriveScrapedBrandName,
  resolveOfficialWebsite,
  runLinksPhase,
} from '../links'
import type { EnrichBrand, EnrichPhase } from '../types'
import { emptyResult } from '../scraper/parse/extractors'
import { mergeScrapedData } from '../scraper/merge'

const scraperMocks = vi.hoisted(() => ({ scrapeBrandUrls: vi.fn() }))
const faviconMocks = vi.hoisted(() => ({ downloadAndStoreFavicon: vi.fn() }))
const brandImagesMocks = vi.hoisted(() => ({ syncLogoDenormalized: vi.fn() }))

vi.mock('../scraper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scraper')>()),
  scrapeBrandUrls: scraperMocks.scrapeBrandUrls,
}))

vi.mock('../favicon-download', () => ({
  downloadAndStoreFavicon: faviconMocks.downloadAndStoreFavicon,
}))

vi.mock('../../brand-images', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../brand-images')>()),
  syncLogoDenormalized: brandImagesMocks.syncLogoDenormalized,
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

  it('excludes institutional hosts from eligible websites', () => {
    expect(
      deriveOfficialWebsite(
        ['https://beboss.wda.gov.tw', 'https://dict.revised.moe.edu.tw'],
        'Han Brand',
      ),
    ).toBeNull()
  })

  it('skips an institutional host on the no-token fallback path', () => {
    expect(
      deriveOfficialWebsite(['https://agency.gov.tw', 'https://shop.example.tw'], '純漢品牌'),
    ).toBe('https://shop.example.tw')
  })
})

// `viaZeroTokenFallback` is the single owner of "this website came from the
// zero-token fallback, not from a name match" — the fact that arms the revoke.
// It is asserted here rather than only through the phase because a token-bearing
// brand's derived site is always identity-confirmed (`linkIdentifiesBrand`
// accepts exactly the hosts `resolveOfficialWebsite` token-matches), so it never
// produces a quarantine group for the flag to ride on. These are the tests that
// go red if the fallback condition inside the function is widened or dropped.
describe('resolveOfficialWebsite provenance', () => {
  it('reports a name-matched host as not a fallback', () => {
    expect(resolveOfficialWebsite(['https://adela-shop.tw/about'], 'ADELA')).toEqual({
      url: 'https://adela-shop.tw',
      viaZeroTokenFallback: false,
    })
  })

  it('reports the first-eligible host of a no-token name as a fallback', () => {
    expect(resolveOfficialWebsite(['https://some-shop.tw/about'], '茶籽堂')).toEqual({
      url: 'https://some-shop.tw',
      viaZeroTokenFallback: true,
    })
  })

  it('reports no fallback when a token-bearing name matches nothing', () => {
    expect(resolveOfficialWebsite(['https://nahoku.com'], 'NU Dream Jewelry')).toEqual({
      url: null,
      viaZeroTokenFallback: false,
    })
  })

  it('reports no fallback when nothing is eligible at all', () => {
    expect(resolveOfficialWebsite(['https://www.instagram.com/brand'], '茶籽堂')).toEqual({
      url: null,
      viaZeroTokenFallback: false,
    })
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

describe('first-party bilingual name evidence', () => {
  it('builds separate website and social candidates from stored first-party URLs', () => {
    const candidates = deriveOfficialNameCandidates(
      {
        ...brand,
        name: 'LID Shoes',
        purchase_website: 'https://www.lidshoes.com/about',
        social_instagram: 'https://www.instagram.com/lidshoes',
      },
      {
        perSourceText: {
          'https://www.lidshoes.com/about': { title: '劉一刀 手工鞋' },
          'https://www.instagram.com/lidshoes': {
            title: '劉一刀手工鞋 LID Shoes',
          },
        },
      },
    )

    expect(candidates).toEqual([
      {
        source: 'official_website',
        value: '劉一刀手工鞋 LID Shoes',
        evidence: [
          {
            source: 'official_website',
            url: 'https://www.lidshoes.com/about',
            observedName: '劉一刀 手工鞋',
          },
        ],
      },
      {
        source: 'official_social',
        value: '劉一刀手工鞋 LID Shoes',
        evidence: [
          {
            source: 'official_social',
            url: 'https://www.instagram.com/lidshoes',
            observedName: '劉一刀手工鞋 LID Shoes',
          },
        ],
      },
    ])
  })

  it('does not turn discovered or retailer titles into name candidates', () => {
    expect(
      deriveOfficialNameCandidates(
        { ...brand, name: 'LID Shoes' },
        {
          perSourceText: {
            'https://retailer.example/lid-shoes': {
              title: '劉一刀手工鞋 LID Shoes',
            },
          },
        },
      ),
    ).toEqual([])
    expect(
      deriveOfficialNameCandidates(
        {
          ...brand,
          name: 'LID Shoes',
          purchase_website: 'https://www.lidshoes.com',
        },
        {
          perSourceText: {
            'https://www.lidshoes.com/discovered-about': {
              title: '劉一刀手工鞋 LID Shoes',
            },
          },
        },
      ),
    ).toEqual([])
  })
})

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

  // Mirrors what `scrapeBrandUrls` really returns: its result has already been
  // through `mergeScrapedData`, whose sourceUrl-present branch populates
  // `perSourceText` alongside `textProvenance`. Omitting it here made the mock
  // stand for a payload production never produces.
  const scrape = (
    sourceUrl: string,
    data: Partial<ReturnType<typeof emptyResult>>,
    options: { withoutPerSourceText?: boolean } = {},
  ) => {
    const merged = mergeScrapedData([{ type: 'official-site', sourceUrl, data: { ...emptyResult(sourceUrl), ...data } }])

    return {
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
        ...(options.withoutPerSourceText || !merged.perSourceText
          ? {}
          : { perSourceText: merged.perSourceText }),
      },
      statuses: [],
    }
  }

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
        unverifiable: true,
      })
    })
  })

  it('does not revoke a token-bearing brand from a derived website', async () => {
    // The revoke can only reach a brand whose name yields Latin tokens if that
    // brand's derived site is quarantined at all — and it never is: the only
    // hosts `resolveOfficialWebsite` returns for a token-bearing name are the
    // ones `linkIdentifiesBrand` then confirms. So the cohort boundary shows up
    // here as "no group", and the flag itself is covered by the
    // `resolveOfficialWebsite provenance` unit tests above.
    scraperMocks.scrapeBrandUrls.mockResolvedValue(scrape('https://adela-shop.tw/about', {}))
    const result = await run({
      brand: { ...brand, name: 'ADELA' },
      discoveredUrls: ['https://adela-shop.tw/about'],
    })

    expect(result.patch.purchase_website).toBe('https://adela-shop.tw')
    expect(result.quarantine['https://adela-shop.tw']).toBeUndefined()
  })

  it('does not revoke the website of a brand that has no name', async () => {
    // A nameless row was never checked against anything: zero tokens means the
    // fallback hands it the SERP's first non-platform host, and revoking that
    // would delete a proposal no rule ever examined. Quarantine still applies —
    // the value is unconfirmed — but the deletion must not be armed.
    scraperMocks.scrapeBrandUrls.mockResolvedValue(scrape('https://some-shop.tw/about', {}))

    const result = await run({
      brand: { ...brand, name: undefined },
      discoveredUrls: ['https://some-shop.tw/about'],
    })

    expect(result.quarantine['https://some-shop.tw']).toMatchObject({ subjectKind: 'website' })
    expect(result.quarantine['https://some-shop.tw']?.unverifiable).toBeFalsy()
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

  it('uses per-source text evidence when the winning text came from another page', async () => {
    scraperMocks.scrapeBrandUrls
      .mockResolvedValueOnce(
        scrape('https://brand.example', {
          description: 'Official description',
          socialInstagram: 'https://www.instagram.com/stranger',
        }),
      )
      .mockResolvedValueOnce(
        scrape('https://www.instagram.com/stranger/', {
          description: 'Stranger description',
          purchasePinkoi: 'https://www.pinkoi.com/store/stranger',
        }),
      )

    const result = await run({
      brand: { ...brand, name: 'Han Brand' },
      discoveredUrls: ['https://brand.example'],
    })

    expect(result.scrapedData?.description).toBe('Official description')
    expect(result.quarantine['https://www.instagram.com/stranger/'].evidence).toEqual({
      description: 'Stranger description',
    })
  })

  // The branch's target cohort: a Han-only name yields no Latin tokens, so
  // `deriveOfficialWebsite` takes the zero-token fallback and returns the page's
  // ORIGIN while the page actually scraped — and the only page carrying
  // `perSourceText` — is a deep URL. A path-sensitive evidence lookup never
  // matches those two, so the website was escalated with empty evidence and the
  // arbiter released it unjudged. A website subject owns its whole domain, so
  // the lookup matches on host.
  it('uses deep-page evidence for an origin website subject', async () => {
    scraperMocks.scrapeBrandUrls.mockResolvedValue(
      scrape('https://mumu.com.tw/pages/about', {
        brandName: 'Mumu',
        description: 'Mumu description',
        story: 'Mumu story',
      }),
    )

    const result = await run({
      brand: { ...brand, name: '純漢品牌' },
      discoveredUrls: ['https://mumu.com.tw/pages/about'],
    })

    const group = result.quarantine['https://mumu.com.tw']
    expect(group.subjectKind).toBe('website')
    expect(group.columns).toContain('purchase_website')
    expect(group.evidence).toEqual({
      title: 'Mumu',
      description: 'Mumu description',
      story: 'Mumu story',
    })
  })

  const secondPassKnownUrls = [
    'https://www.instagram.com/known-one',
    'https://www.instagram.com/known-two',
    'https://www.instagram.com/known-three',
    'https://www.instagram.com/known-four',
    'https://www.instagram.com/known-five',
    'https://www.instagram.com/known-six',
  ]
  const secondPassExtractedSocials = [
    'https://www.instagram.com/from-page',
    'https://www.threads.com/@from-serp',
    'https://www.facebook.com/from-serp',
  ]

  const configureSecondPassMocks = () => {
    scraperMocks.scrapeBrandUrls
      .mockResolvedValueOnce(
        scrape(secondPassKnownUrls[0], {
          socialInstagram: secondPassExtractedSocials[0],
          purchasePinkoi: 'https://www.pinkoi.com/store/from-page',
          purchaseShopee: 'https://shopee.tw/from-page',
        }),
      )
      .mockResolvedValueOnce(scrape(secondPassExtractedSocials[0], {}))
  }

  it('adds at most two new extracted socials after the three normal second-pass URLs', async () => {
    const knownUrls = secondPassKnownUrls
    const extractedSocials = secondPassExtractedSocials

    configureSecondPassMocks()

    // `known-one` leads the discovered list so it becomes the extracted
    // instagram candidate while also sitting in the first pass's six URLs —
    // the exact overlap the zero-token branch's `alreadyScraped` filter exists
    // to drop. Without it, the concession would re-scrape a page this run
    // already paid for.
    await run({
      brand: { ...brand, name: '純漢品牌' },
      knownUrls,
      discoveredUrls: [knownUrls[0], ...extractedSocials],
    })

    expect(scraperMocks.scrapeBrandUrls).toHaveBeenNthCalledWith(
      2,
      [
        extractedSocials[0],
        'https://www.pinkoi.com/store/from-page',
        'https://shopee.tw/from-page',
        extractedSocials[1],
        extractedSocials[2],
      ],
      expect.anything(),
    )
    expect(scraperMocks.scrapeBrandUrls.mock.calls[1][0]).not.toContain(knownUrls[0])
  })

  // Scraped data from before the per-source map exists in flight and in any
  // stored payload, so `textProvenance` has to keep working on its own.
  it('falls back to textProvenance when perSourceText is absent', async () => {
    scraperMocks.scrapeBrandUrls.mockResolvedValue(
      scrape(
        'https://stranger.example/page',
        {
          brandName: 'Stranger Brand',
          description: 'Description from the stranger page',
          purchasePinkoi: 'https://www.pinkoi.com/store/other-company',
        },
        { withoutPerSourceText: true },
      ),
    )

    const result = await run({
      brand: { ...brand, name: 'Han Brand' },
      discoveredUrls: ['https://stranger.example/page'],
    })

    expect(result.scrapedData?.perSourceText).toBeUndefined()
    expect(result.quarantine['https://stranger.example/page'].evidence).toEqual({
      title: 'Stranger Brand',
      description: 'Description from the stranger page',
    })
  })

  // The extra social candidates are a zero-token-only concession: a brand whose
  // name carries Latin tokens already has a discriminator, so its second pass
  // must stay on the plain MAX_SECOND_PASS_URLS budget.
  it('leaves the second pass unchanged for a brand with Latin tokens', async () => {
    const knownUrls = secondPassKnownUrls
    const extractedSocials = secondPassExtractedSocials

    configureSecondPassMocks()

    await run({
      brand: { ...brand, name: 'Han Brand' },
      knownUrls,
      discoveredUrls: extractedSocials,
    })

    expect(scraperMocks.scrapeBrandUrls).toHaveBeenNthCalledWith(
      2,
      [extractedSocials[0], 'https://www.pinkoi.com/store/from-page', 'https://shopee.tw/from-page'],
      expect.anything(),
    )
  })
})

describe('links phase favicon harvesting', () => {
  const fakeSupabase = {} as Parameters<typeof runLinksPhase>[0]['supabase']

  beforeEach(() => {
    scraperMocks.scrapeBrandUrls.mockReset()
    faviconMocks.downloadAndStoreFavicon.mockReset()
    brandImagesMocks.syncLogoDenormalized.mockReset()
  })

  const scrape = (
    sourceUrl: string,
    data: Partial<ReturnType<typeof emptyResult>>,
  ) => {
    const merged = mergeScrapedData([{ type: 'official-site', sourceUrl, data: { ...emptyResult(sourceUrl), ...data } }])
    return {
      data: {
        ...emptyResult(sourceUrl),
        ...data,
        linkProvenance: Object.fromEntries(
          Object.entries(data)
            .filter(([field, value]) => field !== 'brandName' && typeof value === 'string')
            .map(([field]) => [field, { sourceUrl }]),
        ),
        textProvenance: {},
        ...(merged.perSourceText ? { perSourceText: merged.perSourceText } : {}),
      },
      statuses: [],
    }
  }

  it('calls downloadAndStoreFavicon for official site favicon URLs', async () => {
    scraperMocks.scrapeBrandUrls.mockResolvedValue(
      scrape('https://testbrand.com/about', {
        faviconUrls: ['https://testbrand.com/favicon.png', 'https://testbrand.com/icon-192.png'],
      }),
    )
    faviconMocks.downloadAndStoreFavicon.mockResolvedValue('brands/brand-1/favicon.png')
    brandImagesMocks.syncLogoDenormalized.mockResolvedValue(null)

    await runLinksPhase({
      brand,
      phases: ['links'] as EnrichPhase[],
      discoveredUrls: ['https://testbrand.com/about'],
      knownUrls: [],
      supabase: fakeSupabase,
    })

    // First candidate succeeds — second is never tried
    expect(faviconMocks.downloadAndStoreFavicon).toHaveBeenCalledOnce()
    expect(faviconMocks.downloadAndStoreFavicon).toHaveBeenCalledWith(
      'https://testbrand.com/favicon.png',
      'brand-1',
      fakeSupabase,
    )
    expect(brandImagesMocks.syncLogoDenormalized).toHaveBeenCalledOnce()
    expect(brandImagesMocks.syncLogoDenormalized).toHaveBeenCalledWith(
      fakeSupabase,
      'brand-1',
    )
  })

  it('tries the next favicon URL when the first candidate fails', async () => {
    scraperMocks.scrapeBrandUrls.mockResolvedValue(
      scrape('https://testbrand.com/about', {
        faviconUrls: ['https://testbrand.com/favicon.ico', 'https://testbrand.com/icon-192.png'],
      }),
    )
    // First candidate returns null (rejected), second succeeds
    faviconMocks.downloadAndStoreFavicon
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('brands/brand-1/icon-192.png')
    brandImagesMocks.syncLogoDenormalized.mockResolvedValue(null)

    await runLinksPhase({
      brand,
      phases: ['links'] as EnrichPhase[],
      discoveredUrls: ['https://testbrand.com/about'],
      knownUrls: [],
      supabase: fakeSupabase,
    })

    expect(faviconMocks.downloadAndStoreFavicon).toHaveBeenCalledTimes(2)
    expect(faviconMocks.downloadAndStoreFavicon).toHaveBeenNthCalledWith(
      1,
      'https://testbrand.com/favicon.ico',
      'brand-1',
      fakeSupabase,
    )
    expect(faviconMocks.downloadAndStoreFavicon).toHaveBeenNthCalledWith(
      2,
      'https://testbrand.com/icon-192.png',
      'brand-1',
      fakeSupabase,
    )
    expect(brandImagesMocks.syncLogoDenormalized).toHaveBeenCalledOnce()
  })

  it('skips favicon download when faviconUrls is empty', async () => {
    scraperMocks.scrapeBrandUrls.mockResolvedValue(
      scrape('https://testbrand.com/about', {
        faviconUrls: [],
      }),
    )

    await runLinksPhase({
      brand,
      phases: ['links'] as EnrichPhase[],
      discoveredUrls: ['https://testbrand.com/about'],
      knownUrls: [],
      supabase: fakeSupabase,
    })

    expect(faviconMocks.downloadAndStoreFavicon).not.toHaveBeenCalled()
    expect(brandImagesMocks.syncLogoDenormalized).not.toHaveBeenCalled()
  })

  it('skips syncLogoDenormalized when favicon download returns null', async () => {
    scraperMocks.scrapeBrandUrls.mockResolvedValue(
      scrape('https://testbrand.com/about', {
        faviconUrls: ['https://testbrand.com/favicon.png'],
      }),
    )
    faviconMocks.downloadAndStoreFavicon.mockResolvedValue(null)

    await runLinksPhase({
      brand,
      phases: ['links'] as EnrichPhase[],
      discoveredUrls: ['https://testbrand.com/about'],
      knownUrls: [],
      supabase: fakeSupabase,
    })

    expect(faviconMocks.downloadAndStoreFavicon).toHaveBeenCalledOnce()
    expect(brandImagesMocks.syncLogoDenormalized).not.toHaveBeenCalled()
  })

  it('continues without failure when favicon download throws', async () => {
    scraperMocks.scrapeBrandUrls.mockResolvedValue(
      scrape('https://testbrand.com/about', {
        faviconUrls: ['https://testbrand.com/favicon.png'],
      }),
    )
    faviconMocks.downloadAndStoreFavicon.mockRejectedValue(new Error('network error'))

    const result = await runLinksPhase({
      brand,
      phases: ['links'] as EnrichPhase[],
      discoveredUrls: ['https://testbrand.com/about'],
      knownUrls: [],
      supabase: fakeSupabase,
    })

    // Phase should still succeed — favicon is best-effort
    expect(result.phaseResult.status).not.toBe('failed')
    expect(brandImagesMocks.syncLogoDenormalized).not.toHaveBeenCalled()
  })

  it('skips favicon download when supabase is not provided', async () => {
    scraperMocks.scrapeBrandUrls.mockResolvedValue(
      scrape('https://testbrand.com/about', {
        faviconUrls: ['https://testbrand.com/favicon.png'],
      }),
    )

    await runLinksPhase({
      brand,
      phases: ['links'] as EnrichPhase[],
      discoveredUrls: ['https://testbrand.com/about'],
      knownUrls: [],
      // no supabase
    })

    expect(faviconMocks.downloadAndStoreFavicon).not.toHaveBeenCalled()
  })
})
