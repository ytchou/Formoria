import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  classifyByDomain,
  detectInputType,
  isNonBrandSiteHost,
  isThirdPartyDirectoryHost,
} from '../input-detector'

afterEach(() => vi.unstubAllGlobals())

function html(body: string) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
}

describe('classifyByDomain', () => {
  it('maps known hosts', () => {
    expect(classifyByDomain('https://www.instagram.com/brand')).toBe('social')
    expect(classifyByDomain('https://pinkoi.com/store/x')).toBe('e-commerce')
    expect(classifyByDomain('https://myship.7-11.com.tw/general/detail/GM123456')).toBe('e-commerce')
    expect(classifyByDomain('https://my-brand.com')).toBeNull()
  })

  it('input-detector classifies myship as e-commerce', () => {
    expect(
      classifyByDomain('https://myship.7-11.com.tw/general/detail/GM123456'),
    ).toBe('e-commerce')
  })

  it('treats both Threads hosts as social', () => {
    expect(classifyByDomain('https://www.threads.net/@brand')).toBe('social')
    expect(classifyByDomain('https://www.threads.com/@brand')).toBe('social')
  })

  // Aggregators must stay unclassified so they route to SinglePageStrategy and
  // get their links harvested — PlatformAdapterStrategy has no adapter for them
  // and would return an empty result.
  it('leaves link aggregators unclassified', () => {
    expect(classifyByDomain('https://linktr.ee/brand')).toBeNull()
    expect(classifyByDomain('https://bio.site/brand')).toBeNull()
    expect(classifyByDomain('https://portaly.cc/handle')).toBeNull()
  })

  // Same reason: the delivery/directory hosts are an adoption guard only. Putting
  // them in SOCIAL_HOSTS/ECOMMERCE_HOSTS would change how they are SCRAPED.
  it('leaves delivery and directory platforms unclassified', () => {
    expect(classifyByDomain('https://www.ubereats.com/tw/store/brand')).toBeNull()
    expect(classifyByDomain('https://zh.wikipedia.org/wiki/brand')).toBeNull()
  })
})

describe('isNonBrandSiteHost', () => {
  it.each([
    'https://www.instagram.com/brand',
    'https://www.threads.com/@brand',
    'https://www.threads.net/@brand',
    'https://shopee.tw/brand',
    'https://myship.7-11.com.tw/general/detail/GM123456',
    'https://linktr.ee/brand',
    'https://bio.site/brand',
    'https://portaly.cc/handle',
  ])('is true for the platform URL %s', (url) => {
    expect(isNonBrandSiteHost(url)).toBe(true)
  })

  it('input-detector still treats myship as a non-brand host', () => {
    expect(
      isNonBrandSiteHost('https://myship.7-11.com.tw/general/detail/GM123456'),
    ).toBe(true)
  })

  // A live run adopted `https://www.ubereats.com` as a tea brand's own website
  // because its delivery page outranked the brand's domain in the SERP.
  it.each([
    'https://www.ubereats.com/tw/store/brand',
    'https://www.foodpanda.com.tw/restaurant/abcd/brand',
    'https://zh.wikipedia.org/wiki/brand',
    'https://www.tripadvisor.com.tw/Restaurant_Review-brand.html',
    'https://brand.pixnet.net/blog',
  ])('is true for the delivery/directory/publishing platform %s', (url) => {
    expect(isNonBrandSiteHost(url)).toBe(true)
  })

  it('is false for a brand’s own domain', () => {
    expect(isNonBrandSiteHost('https://www.gooddays.tw/collections/all')).toBe(false)
  })

  it('is false for a malformed URL — unknown, not blocked', () => {
    expect(isNonBrandSiteHost('gooddays.tw')).toBe(false)
    expect(isNonBrandSiteHost('')).toBe(false)
  })
})

// DEV-1332: the organiser's own Facebook page, harvested off a creativexpo.tw
// exhibitor listing, was published as 23 unrelated brands' official account.
describe('isThirdPartyDirectoryHost', () => {
  it.each([
    'https://creativexpo.tw/zh-TW/exhibitor_list/120?brand_main_category_id=3',
    'https://www.ubereats.com/tw/store/brand',
    'https://zh.wikipedia.org/wiki/brand',
    'https://myship.7-11.com.tw/general/detail/GM123456',
  ])('is true for the third-party page %s', (url) => {
    expect(isThirdPartyDirectoryHost(url)).toBe(true)
  })

  // A link-in-bio page exists to list ONE brand's accounts, so its links are the
  // brand's own and harvesting them is the entire reason we scrape it.
  it.each(['https://linktr.ee/brand', 'https://bio.site/brand'])(
    'is false for the link aggregator %s',
    (url) => {
      expect(isThirdPartyDirectoryHost(url)).toBe(false)
    },
  )

  it('is false for a social or marketplace profile — those are gated elsewhere', () => {
    expect(isThirdPartyDirectoryHost('https://www.instagram.com/brand')).toBe(false)
    expect(isThirdPartyDirectoryHost('https://www.pinkoi.com/store/brand')).toBe(false)
  })

  it('is false for a brand’s own domain and for a malformed URL', () => {
    expect(isThirdPartyDirectoryHost('https://www.gooddays.tw')).toBe(false)
    expect(isThirdPartyDirectoryHost('gooddays.tw')).toBe(false)
  })
})

describe('detectInputType', () => {
  it('returns deep-multi-page when nav has many internal sections', async () => {
    const nav = '<nav>' + ['/about','/products','/story','/contact'].map(h => `<a href="${h}">x</a>`).join('') + '</nav>'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(html(`<html><body>${nav}</body></html>`)))
    await expect(detectInputType('https://brand.com')).resolves.toBe('deep-multi-page')
  })
  it('returns official-site for a sparse landing page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(html('<html><body><h1>Hi</h1></body></html>')))
    await expect(detectInputType('https://brand.com')).resolves.toBe('official-site')
  })
})
