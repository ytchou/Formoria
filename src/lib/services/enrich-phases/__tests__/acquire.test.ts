import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deriveOfficialNameCandidates,
  deriveOfficialWebsite,
  deriveScrapedBrandName,
  resolveOfficialWebsite,
  runAcquirePhase,
} from '../acquire'
import type { EnrichBrand, EnrichPhase } from '../types'
import type { EnrichmentTarget } from '../../_shared/enrichment-target'
import type {
  ClassifiedImage,
  HeroOrderOutcome,
} from '../classify-images'
import type { GatedImage, StoredImageRecord } from '../../image-download'
import type { BrandImageSearchOutcome } from '../scraper/types'
import { emptyResult } from '../scraper/parse/extractors'
import { mergeScrapedData } from '../scraper/merge'

const scraperMocks = vi.hoisted(() => ({ scrapeBrandUrls: vi.fn() }))
const acquisitionMocks = vi.hoisted(() => ({ runAcquisition: vi.fn() }))

vi.mock('../scraper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../scraper')>()),
  scrapeBrandUrls: scraperMocks.scrapeBrandUrls,
}))

vi.mock('../acquisition/graph', () => ({
  runAcquisition: acquisitionMocks.runAcquisition,
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

describe('runAcquirePhase', () => {
  it('returns skipped when acquire is not in requested phases', async () => {
    const result = await runAcquirePhase({
      brand,
      phases: ['detect'] as EnrichPhase[],
      discoveredUrls: ['https://www.instagram.com/testbrand/'],
      knownUrls: [],
    })

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.phaseResult.phase).toBe('acquire')
    expect(result.patch).toEqual({})
    // The scraped title is a candidate for the names phase, never a patch key.
    expect(result.scrapedBrandName).toBeNull()
    expect(result.scrapedData).toBeNull()
  })

  it('returns empty jsonLdImageUrls when the acquire phase is skipped', async () => {
    const result = await runAcquirePhase({
      brand,
      phases: ['detect'] as EnrichPhase[],
      discoveredUrls: [],
      knownUrls: [],
    })
    expect(result.jsonLdImageUrls).toEqual([])
  })

  it('acquire_runs_when_phases_contains_acquire', async () => {
    scraperMocks.scrapeBrandUrls.mockReset()
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      scrapeResult: {
        data: {
          ...emptyResult('https://testbrand.com'),
          purchaseWebsite: 'https://testbrand.com',
          purchase_website: 'https://testbrand.com',
        },
        statuses: [],
      },
      decisions: [],
    })

    const result = await runAcquirePhase({
      brand,
      phases: ['acquire'] as EnrichPhase[],
      discoveredUrls: ['https://testbrand.com/about'],
      knownUrls: [],
    })

    expect(result.phaseResult.status).toBe('succeeded')
    // The phase owns the string `acquire` everywhere it is persisted:
    // phase_results, satisfaction history, current_phase.
    expect(result.phaseResult.phase).toBe('acquire')
  })

  it('acquire_does_not_run_on_the_retired_links_name', async () => {
    // Normalization happens at the runner entry points, never here: a phase
    // gates on its own name only (the sibling rule in products.ts/detect.ts).
    scraperMocks.scrapeBrandUrls.mockReset()

    const result = await runAcquirePhase({
      brand,
      phases: ['links'] as EnrichPhase[],
      discoveredUrls: ['https://testbrand.com/about'],
      knownUrls: [],
    })

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.phaseResult.phase).toBe('acquire')
    expect(scraperMocks.scrapeBrandUrls).not.toHaveBeenCalled()
  })
})

describe('acquire quarantine identity rules', () => {
  beforeEach(() => {
    scraperMocks.scrapeBrandUrls.mockReset()
    acquisitionMocks.runAcquisition.mockReset()
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

  /** Mock the agent to return planned with the given scrape data. */
  const mockAgent = (
    sourceUrl: string,
    data: Partial<ReturnType<typeof emptyResult>>,
    options?: { withoutPerSourceText?: boolean },
  ) => {
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      scrapeResult: scrape(sourceUrl, data, options),
      decisions: [],
    })
  }

  const run = async (overrides: Partial<Parameters<typeof runAcquirePhase>[0]>) =>
    runAcquirePhase({
      brand,
      phases: ['acquire'] as EnrichPhase[],
      discoveredUrls: [],
      knownUrls: [],
      ...overrides,
    })

  it('a known-url source page is confirmed', () => {
    mockAgent('https://dtbbag.com/about', {
      socialFacebook: 'https://www.facebook.com/stranger',
    })

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
    mockAgent('https://stranger.example/page', {
      purchasePinkoi: 'https://www.pinkoi.com/store/other-company',
    })

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
    mockAgent('https://stranger.example/page', {
      socialFacebook: 'https://www.facebook.com/other-company',
    })

    return run({
      brand: { ...brand, name: 'Han Brand' },
      discoveredUrls: ['https://stranger.example/page'],
    }).then((result) => {
      expect(result.patch.social_facebook).toBeUndefined()
      expect(result.quarantine).toEqual({})
    })
  })

  it('a SERP source page passing the predicate does not quarantine', () => {
    mockAgent('https://han.example/page', {
      socialFacebook: 'https://www.facebook.com/han-brand',
    })

    return run({
      brand: { ...brand, name: 'Han Brand' },
      discoveredUrls: ['https://han.example/page'],
    }).then((result) => expect(result.quarantine).toEqual({}))
  })

  it('an unconfirmed candidate website is quarantined', () => {
    mockAgent('https://some-shop.tw', {})

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
    mockAgent('https://adela-shop.tw/about', {})
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
    mockAgent('https://some-shop.tw/about', {})

    const result = await run({
      brand: { ...brand, name: undefined },
      discoveredUrls: ['https://some-shop.tw/about'],
    })

    expect(result.quarantine['https://some-shop.tw']).toMatchObject({ subjectKind: 'website' })
    expect(result.quarantine['https://some-shop.tw']?.unverifiable).toBeFalsy()
  })

  it('a link whose provenance points to a non-confirmed page is quarantined', async () => {
    // The agent scraped two pages: brand.example found an Instagram link, and
    // that Instagram page found a Pinkoi link. The Pinkoi link's provenance
    // points to the stranger's Instagram page, which is not confirmed.
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      scrapeResult: {
        data: {
          ...emptyResult('https://brand.example'),
          socialInstagram: 'https://www.instagram.com/stranger',
          purchasePinkoi: 'https://www.pinkoi.com/store/stranger',
          linkProvenance: {
            socialInstagram: { sourceUrl: 'https://brand.example' },
            purchasePinkoi: { sourceUrl: 'https://www.instagram.com/stranger' },
          },
        },
        statuses: [],
      },
      decisions: [],
    })

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
    mockAgent('https://stranger.example/page', {
      purchaseMyship: 'https://myship.example/order/123',
    })

    return run({
      brand: { ...brand, name: 'Han Brand' },
      discoveredUrls: ['https://stranger.example/page'],
    }).then((result) => {
      expect(result.patch.purchase_myship).toBe('https://myship.example/order/123')
      expect(result.quarantine['https://stranger.example/page'].columns).toContain('purchase_myship')
    })
  })

  it('provenance survives and quarantine carries evidence', async () => {
    // The agent merged data from two pages: a stranger's Instagram page supplied
    // both text and a Pinkoi link. Provenance maps and per-source text must
    // survive into the quarantine evidence.
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      scrapeResult: {
        data: {
          ...emptyResult('https://brand.example'),
          socialInstagram: 'https://www.instagram.com/stranger',
          purchasePinkoi: 'https://www.pinkoi.com/store/stranger',
          description: 'Description from the stranger page',
          linkProvenance: {
            socialInstagram: { sourceUrl: 'https://brand.example' },
            purchasePinkoi: { sourceUrl: 'https://www.instagram.com/stranger' },
          },
          textProvenance: {
            description: { sourceUrl: 'https://www.instagram.com/stranger' },
          },
          perSourceText: {
            'https://www.instagram.com/stranger': {
              title: 'Stranger Brand',
              description: 'Description from the stranger page',
            },
          },
        },
        statuses: [],
      },
      decisions: [],
    })

    const result = await run({
      brand: { ...brand, name: 'Han Brand' },
      discoveredUrls: ['https://brand.example'],
    })

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
    // The winning description came from brand.example (first-wins merge), but
    // the stranger's Instagram page has its own per-source text. The quarantine
    // evidence for the Instagram page must use its own description.
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      scrapeResult: {
        data: {
          ...emptyResult('https://brand.example'),
          description: 'Official description',
          socialInstagram: 'https://www.instagram.com/stranger/',
          purchasePinkoi: 'https://www.pinkoi.com/store/stranger',
          linkProvenance: {
            socialInstagram: { sourceUrl: 'https://brand.example' },
            purchasePinkoi: { sourceUrl: 'https://www.instagram.com/stranger/' },
          },
          textProvenance: {
            description: { sourceUrl: 'https://brand.example' },
          },
          perSourceText: {
            'https://www.instagram.com/stranger/': {
              description: 'Stranger description',
            },
          },
        },
        statuses: [],
      },
      decisions: [],
    })

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
    mockAgent('https://mumu.com.tw/pages/about', {
      brandName: 'Mumu',
      description: 'Mumu description',
      story: 'Mumu story',
    })

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

  // Scraped data from before the per-source map exists in flight and in any
  // stored payload, so `textProvenance` has to keep working on its own.
  it('falls back to textProvenance when perSourceText is absent', async () => {
    mockAgent(
      'https://stranger.example/page',
      {
        brandName: 'Stranger Brand',
        description: 'Description from the stranger page',
        purchasePinkoi: 'https://www.pinkoi.com/store/other-company',
      },
      { withoutPerSourceText: true },
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

})

describe('acquisition agent integration', () => {
  beforeEach(() => {
    scraperMocks.scrapeBrandUrls.mockReset()
    acquisitionMocks.runAcquisition.mockReset()
  })

  const agentBrand: EnrichBrand = {
    id: 'brand-agent',
    slug: 'agent-brand',
    name: 'Agent Brand',
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
    purchase_website: null,
    purchase_pinkoi: null,
    purchase_shopee: null,
  }

  const agentRun = (overrides: Partial<Parameters<typeof runAcquirePhase>[0]> = {}) =>
    runAcquirePhase({
      brand: agentBrand,
      phases: ['acquire'] as EnrichPhase[],
      discoveredUrls: ['https://agentbrand.com/about'],
      knownUrls: [],
      ...overrides,
    })

  it('acquire_uses_agent_scrape_result_when_planned', async () => {
    const agentScrapeData = {
      ...emptyResult('https://agentbrand.com'),
      purchaseWebsite: 'https://agentbrand.com',
      purchase_website: 'https://agentbrand.com',
      brandName: 'Agent Brand',
    }
    const agentPlan = {
      surfaces: [{ url: 'https://agentbrand.com', fetch: 'static' as const, reason: 'official site', strategy: 'official-site' as const }],
      fanOut: [],
      catalog: { entryUrls: [], priorityProductUrls: [] },
      socialBios: {},
      decisions: [],
    }

    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      plan: agentPlan,
      scrapeResult: { data: agentScrapeData, statuses: [] },
      decisions: [],
    })

    const result = await agentRun()

    expect(result.phaseResult.status).toBe('succeeded')
    expect(result.scrapedData?.purchaseWebsite).toBe('https://agentbrand.com')
    expect(result.acquisitionPlan).toBeTruthy()
    expect(result.acquisitionPlan?.surfaces).toHaveLength(1)
    // Legacy scraper should NOT have been called
    expect(scraperMocks.scrapeBrandUrls).not.toHaveBeenCalled()
  })

  // A refresh whose link columns are already correct leaves an EMPTY patch. The
  // first staging run reported `skipped` for 6/10 brands on exactly that, while
  // the agent had planned, scraped text, classified images and found a catalog.
  it('acquire_status_succeeded_when_agent_planned_with_images_but_empty_patch', async () => {
    const settledBrand: EnrichBrand = {
      ...agentBrand,
      purchase_website: 'https://agentbrand.com',
    }
    const agentScrapeData = {
      ...emptyResult('https://agentbrand.com'),
      purchaseWebsite: 'https://agentbrand.com',
      purchase_website: 'https://agentbrand.com',
      description: 'A ceramics studio in Yingge.',
    }

    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      plan: {
        surfaces: [
          {
            url: 'https://agentbrand.com',
            fetch: 'static' as const,
            reason: 'official site',
            strategy: 'official-site' as const,
          },
        ],
        fanOut: [],
        catalog: { entryUrls: [], priorityProductUrls: [] },
        socialBios: {},
        decisions: [],
      },
      scrapeResult: { data: agentScrapeData, statuses: [] },
      imagePool: [
        { id: 'img-1', tag: 'product', score: 90, sourceUrl: 'https://agentbrand.com' },
      ],
      catalogResult: {
        triples: [
          {
            url: 'https://agentbrand.com/products/cup',
            title: 'Cup',
            imageUrl: 'https://agentbrand.com/cup.jpg',
            platform: 'generic' as const,
            supplier: 'official',
            sourceUrl: 'https://agentbrand.com',
            sourcePosition: 0,
          },
        ],
        attempts: [],
        evidence: new Map(),
      },
      decisions: [],
    })

    const result = await agentRun({ brand: settledBrand })

    // The patch really is empty — the status is about the evidence, not the diff.
    expect(result.patch).toEqual({})
    expect(result.phaseResult.status).toBe('succeeded')
    expect(result.phaseResult.changedFields).toEqual(
      expect.arrayContaining(['images', 'catalog']),
    )
  })

  it('acquire_status_skipped_when_nothing_acquired', async () => {
    const settledBrand: EnrichBrand = {
      ...agentBrand,
      purchase_website: 'https://agentbrand.com',
    }

    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      decisions: [],
      imagePool: [],
    })

    const result = await agentRun({
      brand: settledBrand,
      discoveredUrls: ['https://agentbrand.com'],
    })

    expect(result.patch).toEqual({})
    expect(result.phaseResult.status).toBe('skipped')
    expect(result.phaseResult.changedFields).toEqual([])
  })

  it('test_agent_throw_produces_blocked_not_fallback', async () => {
    acquisitionMocks.runAcquisition.mockRejectedValue(new Error('agent crashed'))

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await agentRun()

    expect(result.phaseResult.agentOutcome).toBe('blocked')
    expect(result.phaseResult.acquisitionPlan).toMatchObject({
      error: expect.stringContaining('agent crashed'),
    })
    // Legacy scraper must NOT run — the agent is the only path.
    expect(scraperMocks.scrapeBrandUrls).not.toHaveBeenCalled()
    expect(result.acquisitionPlan).toBeUndefined()

    error.mockRestore()
  })

  const agentDataForScale = () => ({
    ...emptyResult('https://agentbrand.com'),
    purchaseWebsite: 'https://agentbrand.com',
    purchase_website: 'https://agentbrand.com',
  })

  it('budget_scale_is_forwarded_to_run_acquisition', async () => {
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      scrapeResult: { data: agentDataForScale(), statuses: [] },
      decisions: [],
    })

    await agentRun({ budgetScale: 1.5 })

    const options = acquisitionMocks.runAcquisition.mock.calls[0][2]
    expect(options.budgetScale).toBe(1.5)
  })

  it('link_expansion_is_recorded_on_phase_result', async () => {
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      scrapeResult: { data: agentDataForScale(), statuses: [] },
      decisions: [],
    })

    const linkExpansion = {
      hubsFetched: 2,
      adopted: [
        { field: 'social_instagram', url: 'https://instagram.com/brand', source: 'hub' as const },
      ],
      serp: 'searched' as const,
    }

    const result = await agentRun({ linkExpansion })

    expect(result.phaseResult.linkExpansion).toEqual(linkExpansion)
    expect(result.phaseResult.changedFields).toContain('social_instagram')
  })

  it('test_agent_runs_unconditionally', async () => {
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      scrapeResult: { data: agentDataForScale(), statuses: [] },
      decisions: [],
    })

    await agentRun()

    // The agent runs without checking any env var — no dedicated agent guard.
    expect(acquisitionMocks.runAcquisition).toHaveBeenCalledTimes(1)
  })

  it('test_no_legacy_scrape_when_agent_has_no_data', async () => {
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      decisions: [],
      imagePool: [],
    })

    const result = await agentRun()

    // The legacy scraper must not run — scrapedFromPages falls back to {}.
    expect(scraperMocks.scrapeBrandUrls).not.toHaveBeenCalled()
    expect(result.scrapedBrandName).toBeNull()
  })

  it('acquire_phase_not_requested_still_returns_skipped', async () => {
    const result = await runAcquirePhase({
      brand: agentBrand,
      phases: ['detect'] as EnrichPhase[],
      discoveredUrls: [],
      knownUrls: [],
    })
    expect(result.phaseResult.status).toBe('skipped')
    expect(result.phaseResult.phase).toBe('acquire')
    expect(result.acquisitionPlan).toBeUndefined()
  })
})

/**
 * The acquire fold (DEV-1644 PR 4, task 4).
 *
 * Before this, `runAcquirePhase` handed the agent three dependencies, so the
 * images / catalog / recovery-search nodes never ran in production: no image was
 * downloaded or classified, no catalog was discovered, the critique's
 * `urlVerdicts` had no consumer, and `providerFailure` was never set. These
 * cases pin the wiring — every dependency injected, and the DB writes performed
 * by the phase after the agent returns.
 *
 * Fakes go through the `deps` seam rather than a module mock:
 * `scripts/check-test-boundaries.mjs` refuses a service or Supabase mock, and a
 * seam is what lets the write path be asserted without a live client.
 */
describe('acquire fold', () => {
  const FOLD_SITE = 'https://foldbrand.com'
  const FOLD_PINKOI = 'https://www.pinkoi.com/store/foldbrand'
  const FOLD_PAGE = `${FOLD_SITE}/products/plate`

  const foldBrand: EnrichBrand = {
    id: 'brand-fold',
    slug: 'fold-brand',
    name: 'Fold Brand',
    category: 'home',
    purchase_website: FOLD_SITE,
    purchase_pinkoi: FOLD_PINKOI,
    purchase_shopee: null,
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
  }

  const agentData = (overrides: Record<string, unknown> = {}) => ({
    ...emptyResult(FOLD_SITE),
    purchaseWebsite: FOLD_SITE,
    purchase_website: FOLD_SITE,
    ...overrides,
  })

  const classifiedImage = (): ClassifiedImage => ({
    id: 'image-1',
    tag: 'product',
    score: 82,
    disposition: 'keep',
    storage_path: 'brands/fold/image-1.webp',
    width: 1200,
    height: 900,
    sourceUrl: FOLD_PAGE,
  })

  const fakeGatedImage = (): GatedImage => ({
    buffer: Buffer.from('fake'),
    contentType: 'image/webp',
    width: 1200,
    height: 900,
    dominantColor: '#FFFFFF',
    phash: 'ph-fold',
    entropy: 7.0,
    sharpness: 50,
    source: 'scrape',
    sourceUrl: `${FOLD_SITE}/img/plate.jpg`,
    provider: {} as GatedImage['provider'],
  })

  const fakeClassifiedKeep = () => ({
    ...fakeGatedImage(),
    disposition: 'keep' as const,
    tag: 'product',
    score: 82,
    caption: 'A product image',
  })

  const fakeStoredRecord = (): StoredImageRecord => ({
    id: 'image-1',
    storage_path: 'brands/fold/image-1.webp',
    source_url: `${FOLD_SITE}/img/plate.jpg`,
  })

  const stubDownloadAndGate = () =>
    vi.fn(async (_candidates: unknown[], _target: unknown): Promise<GatedImage[]> => [
      fakeGatedImage(),
    ])

  const stubClassifyBuffers = () => {
    const calls: unknown[][] = []
    const fn = vi.fn(async (gated: unknown[], _options?: unknown) => {
      calls.push(gated)
      return [fakeClassifiedKeep()]
    })
    return { fn, calls }
  }

  const stubStoreKept = () =>
    vi.fn(async (_kept: unknown[], _target: unknown, _supabase?: unknown): Promise<StoredImageRecord[]> => [
      fakeStoredRecord(),
    ])

  const stubHero = () =>
    vi.fn(
      async (
        _supabase: unknown,
        _target: EnrichmentTarget,
        _options: { mode: 'classify' | 'resort' },
      ): Promise<HeroOrderOutcome> => ({
        assignments: [],
        candidateIds: [],
        demotedIds: [],
        rejectedIds: [],
        heroStoragePath: 'brands/fold/image-1.webp',
      }),
    )

  // Declares its parameters so the profile key AND the audit context can be
  // asserted; the phase must ask the shared runtime for the `acquisition`
  // profile, never build a model. Audit attribution is fixed here, at
  // construction — the graph carries no audit context of its own.
  const model = vi.fn(async (_profileKey: string, _audit?: unknown) => ({
    invoke: async () => ({ content: '{}' }),
  }))

  const foldRun = (overrides: Partial<Parameters<typeof runAcquirePhase>[0]> = {}) =>
    runAcquirePhase({
      brand: foldBrand,
      phases: ['acquire'] as EnrichPhase[],
      discoveredUrls: [`${FOLD_SITE}/about`],
      knownUrls: [FOLD_SITE],
      supabase: {} as never,
      jobId: 'job-fold',
      ...overrides,
      deps: { createAgentModel: model, ...(overrides.deps ?? {}) },
    })

  const plannedAgent = (output: Record<string, unknown> = {}) =>
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      scrapeResult: { data: agentData(), statuses: [] },
      decisions: [],
      ...output,
    })

  beforeEach(() => {
    scraperMocks.scrapeBrandUrls.mockReset()
    acquisitionMocks.runAcquisition.mockReset()
    model.mockClear()
  })

  it('acquire_injects_all_agent_deps_in_production_path', async () => {
    plannedAgent()

    await foldRun()

    const deps = acquisitionMocks.runAcquisition.mock.calls[0][1]
    for (const name of [
      'fetchHtml',
      'scrapeBrandUrls',
      'downloadAndGateImages',
      'classifyImageBuffers',
      'storeKeptImages',
      'discoverCatalog',
      'searchBrand',
      'searchImages',
    ]) {
      expect(typeof deps[name], `${name} must be injected`).toBe('function')
    }
    expect(deps.catalogSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: FOLD_SITE, channel: 'official' }),
        expect.objectContaining({ url: FOLD_PINKOI, channel: 'pinkoi' }),
      ]),
    )
  })

  it('acquire_uses_createAgentModel_acquisition', async () => {
    plannedAgent()

    await foldRun()

    // The runtime factory is the one that omits `response_format: json_object`,
    // which the client refuses alongside the plan node's four tool definitions.
    // The audit context travels with the MODEL, not with the run options: every
    // turn the graph makes on it writes a row keyed to this phase, job and target.
    expect(model).toHaveBeenCalledWith(
      'acquisition',
      expect.objectContaining({
        phase: 'acquire',
        jobId: 'job-fold',
        target: expect.objectContaining({ id: foldBrand.id }),
      }),
    )
    expect(acquisitionMocks.runAcquisition.mock.calls[0][2].model).toBeDefined()
    expect(acquisitionMocks.runAcquisition.mock.calls[0][2]).not.toHaveProperty('audit')
  })

  it('acquire_writes_images_after_agent', async () => {
    const classifyBuffers = stubClassifyBuffers()
    const finalizeHeroOrder = stubHero()
    const downloadAndGateImages = stubDownloadAndGate()
    const storeKeptImages = stubStoreKept()

    acquisitionMocks.runAcquisition.mockImplementation(async (_input, deps) => {
      const gated = await deps.downloadAndGateImages([
        { url: `${FOLD_SITE}/img/plate.jpg`, source: 'scrape', pageUrl: FOLD_PAGE },
      ])
      const classified = await deps.classifyImageBuffers(gated)
      const keeps = classified.filter((img: { disposition: string }) => img.disposition === 'keep')
      const stored = await deps.storeKeptImages(keeps)
      return {
        agentOutcome: 'planned',
        scrapeResult: { data: agentData(), statuses: [] },
        imagePool: stored.map((r: { id: string; storage_path: string; source_url: string }) => ({
          id: r.id,
          tag: 'product',
          score: 82,
          storage_path: r.storage_path,
          sourceUrl: r.source_url,
        })),
        decisions: [],
      }
    })

    const result = await foldRun({
      deps: {
        classifyImageBuffers: classifyBuffers.fn,
        finalizeHeroOrder,
        downloadAndGateImages,
        storeKeptImages,
      },
    })

    expect(downloadAndGateImages).toHaveBeenCalledTimes(1)
    expect(classifyBuffers.calls).toHaveLength(1)
    expect(storeKeptImages).toHaveBeenCalledTimes(1)
    // A brand target denormalizes its hero inside `finalizeHeroOrder`; what this
    // phase owns is that the re-rank runs at all, in classify mode.
    expect(finalizeHeroOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'brand', id: foldBrand.id }),
      { mode: 'classify' },
    )
    expect(result.imagePool).toHaveLength(1)
  })

  it('acquire_dry_run_writes_nothing', async () => {
    const classifyBuffers = stubClassifyBuffers()
    const finalizeHeroOrder = stubHero()
    const downloadAndGateImages = stubDownloadAndGate()
    const storeKeptImages = stubStoreKept()
    plannedAgent()

    await foldRun({
      dryRun: true,
      deps: {
        classifyImageBuffers: classifyBuffers.fn,
        finalizeHeroOrder,
        downloadAndGateImages,
        storeKeptImages,
      },
    })

    // The buffer pipeline seams are not even handed to the agent, so a dry
    // run cannot store or judge an image however the graph behaves.
    const deps = acquisitionMocks.runAcquisition.mock.calls[0][1]
    expect(deps.downloadAndGateImages).toBeUndefined()
    expect(deps.classifyImageBuffers).toBeUndefined()
    expect(deps.storeKeptImages).toBeUndefined()
    expect(downloadAndGateImages).not.toHaveBeenCalled()
    expect(classifyBuffers.calls).toHaveLength(0)
    expect(storeKeptImages).not.toHaveBeenCalled()
    expect(finalizeHeroOrder).not.toHaveBeenCalled()
  })

  const quarantinedRun = (confidence: 'high' | 'medium') => {
    // A zero-Latin-token name takes `resolveOfficialWebsite`'s fallback, so the
    // proposed website is unconfirmed — the one quarantine group this phase can
    // produce for a website subject.
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      scrapeResult: { data: emptyResult('https://some-shop.tw'), statuses: [] },
      urlVerdicts: [
        {
          url: 'https://some-shop.tw',
          owned: false,
          confidence,
          reason: 'a different company',
        },
      ],
      decisions: [],
    })

    return foldRun({
      brand: { ...foldBrand, name: '茶籽堂', purchase_website: null, purchase_pinkoi: null },
      knownUrls: [],
      discoveredUrls: ['https://some-shop.tw/about'],
    })
  }

  it('acquire_revokes_on_high_confidence_not_owned', async () => {
    const result = await quarantinedRun('high')

    expect(result.patch.purchase_website).toBeUndefined()
    expect(result.revokedColumns).toContain('purchase_website')
    expect(result.phaseResult.revokedColumns).toContain('purchase_website')
  })

  it('acquire_releases_on_medium_confidence', async () => {
    const result = await quarantinedRun('medium')

    expect(result.patch.purchase_website).toBe('https://some-shop.tw')
    expect(result.revokedColumns).toEqual([])
    expect(result.phaseResult.revokedColumns).toBeUndefined()
  })

  it('acquire_sets_provider_failure_from_agent', async () => {
    plannedAgent({ providerFailure: true })

    const result = await foldRun()

    expect(result.providerFailure).toBe(true)
    expect(result.phaseResult.providerFailure).toBe(true)
  })

  it('acquire_output_carries_image_pool_catalog_and_page_urls', async () => {
    plannedAgent({
      imagePool: [classifiedImage()],
      catalogResult: {
        triples: [
          {
            url: FOLD_PAGE,
            title: 'Plate',
            imageUrl: `${FOLD_SITE}/img/plate.jpg`,
            platform: 'generic',
            supplier: 'catalog:generic',
            sourceUrl: FOLD_SITE,
            sourcePosition: 0,
          },
        ],
        attempts: [],
        evidence: new Map(),
      },
      acquisitionPageUrls: [FOLD_PAGE],
    })

    const result = await foldRun()

    expect(result.imagePool).toHaveLength(1)
    expect(result.imagePool[0]!.sourceUrl).toBe(FOLD_PAGE)
    expect(result.catalogResult?.triples).toHaveLength(1)
    expect(result.acquisitionPageUrls).toEqual([FOLD_PAGE])
    // What is PERSISTED is the compact summary, not the full pool.
    expect(result.phaseResult.imagePool).toEqual([
      { id: 'image-1', tag: 'product', score: 82, sourceUrl: FOLD_PAGE },
    ])
  })

  it('acquire_search_deps_write_brand_search_results_rows', async () => {
    // `search_type` is decided inside the serper client — `serp` for
    // `searchBrandUrls`, `image` for `batchSearchBrandImages` — so what this
    // phase owns is handing both of them the audit context that keys the
    // `brand_search_results` row to this target and job.
    const searchBrandUrls = vi.fn(
      async (_name: string, _template?: unknown, _audit?: unknown): Promise<string[]> => [
        'https://found.example',
      ],
    )
    const batchSearchBrandImages = vi.fn(
      async (
        _inputs: unknown[],
        _concurrency?: number,
        _template?: unknown,
        _resolver?: unknown,
      ): Promise<Map<string, BrandImageSearchOutcome>> =>
        new Map([
          [
            'Fold Brand',
            {
              rows: [{ url: 'https://found.example/i.jpg', query: 'Fold Brand' }],
              callStatus: 'succeeded' as const,
              httpStatus: null,
              error: null,
            },
          ],
        ]),
    )

    let searchedUrls: string[] = []
    let searchedImages: string[] = []
    acquisitionMocks.runAcquisition.mockImplementation(async (_input, deps) => {
      searchedUrls = (await deps.searchBrand('Fold Brand')).urls
      searchedImages = await deps.searchImages({
        brandName: 'Fold Brand',
        websiteHost: 'foldbrand.com',
      })
      return {
        agentOutcome: 'planned',
        scrapeResult: { data: agentData(), statuses: [] },
        decisions: [],
      }
    })

    await foldRun({ deps: { searchBrandUrls, batchSearchBrandImages } })

    expect(searchedUrls).toEqual(['https://found.example'])
    expect(searchedImages).toEqual(['https://found.example/i.jpg'])
    expect(searchBrandUrls.mock.calls[0]![2]).toMatchObject({
      target: { type: 'brand', id: foldBrand.id },
      jobId: 'job-fold',
      config: { phase: 'acquire' },
    })
    const resolver = batchSearchBrandImages.mock.calls[0]![3] as () => unknown
    expect(resolver()).toMatchObject({
      target: { type: 'brand', id: foldBrand.id },
      jobId: 'job-fold',
      config: { phase: 'acquire' },
    })
  })

  it('catalog_discovery_runs_when_agent_returned_no_catalog', async () => {
    const discoverCatalog = vi.fn(async () => ({
      triples: [
        {
          url: `${FOLD_SITE}/products/plate`,
          title: 'Plate',
          imageUrl: `${FOLD_SITE}/img/plate.jpg`,
          platform: 'generic' as const,
          supplier: 'catalog:generic',
          sourceUrl: FOLD_SITE,
          sourcePosition: 0,
        },
      ],
      attempts: [],
      evidence: new Map(),
    }))

    // Agent returned no scrapeResult and no catalogResult — the fallback
    // catalog discovery runs from entry URLs.
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      decisions: [],
      imagePool: [],
    })

    const result = await foldRun({ deps: { discoverCatalog } })

    expect(discoverCatalog).toHaveBeenCalledTimes(1)
    const opts = (discoverCatalog.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(opts.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: FOLD_SITE, channel: 'official' }),
      ]),
    )
    expect(opts.entryUrls).toEqual(
      expect.arrayContaining([`${FOLD_SITE}/about`]),
    )
    expect(opts.priorityProductUrls).toEqual([])
    expect(result.catalogResult?.triples).toHaveLength(1)
  })

  it('discover_catalog_errors_are_swallowed', async () => {
    const discoverCatalog = vi.fn(async () => {
      throw new Error('catalog boom')
    })

    // Agent returned no scrapeResult and no catalog — fallback catalog
    // discovery runs but throws; the error is swallowed.
    acquisitionMocks.runAcquisition.mockResolvedValue({
      agentOutcome: 'planned',
      decisions: [],
      imagePool: [],
    })

    const result = await foldRun({ deps: { discoverCatalog } })

    expect(result.catalogResult).toBeUndefined()
    // No data from agent and no catalog → skipped.
    expect(result.phaseResult.status).toBe('skipped')
  })

})
