import { describe, expect, it } from 'vitest'
import { deriveOfficialWebsite, deriveScrapedBrandName, runLinksPhase } from '../links'
import type { EnrichBrand, EnrichPhase } from '../types'

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
