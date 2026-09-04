import { describe, expect, it, vi } from 'vitest'
import {
  collectHubUrls,
  expandLinkHubs,
  hasPurchaseChannel,
  unwrapRedirectWrapper,
  type LinkExpansionBrand,
} from '../link-expansion'

// ---------------------------------------------------------------------------
// hasPurchaseChannel
// ---------------------------------------------------------------------------
describe('hasPurchaseChannel', () => {
  it('returns true when at least one purchase column is filled', () => {
    expect(
      hasPurchaseChannel({ purchase_website: 'https://brand.com' }),
    ).toBe(true)
    expect(
      hasPurchaseChannel({ purchase_pinkoi: 'https://pinkoi.com/store/x' }),
    ).toBe(true)
  })

  it('returns false when all purchase columns are absent or null', () => {
    expect(hasPurchaseChannel({})).toBe(false)
    expect(
      hasPurchaseChannel({
        purchase_website: null,
        purchase_pinkoi: null,
        purchase_shopee: null,
        purchase_myship: null,
      }),
    ).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// collectHubUrls
// ---------------------------------------------------------------------------
describe('collectHubUrls', () => {
  it('reads website_url, other_urls, and purchase_website — de-duplicated', () => {
    const brand: LinkExpansionBrand = {
      website_url: 'https://linktr.ee/mybrand',
      other_urls: [
        { label: 'Hub', url: 'https://portaly.cc/mybrand' },
        { label: 'Also hub', url: 'https://linktr.ee/mybrand' }, // duplicate
      ],
      purchase_website: 'https://linktr.ee/mybrand', // duplicate
    }
    const urls = collectHubUrls(brand)
    expect(urls).toEqual([
      'https://linktr.ee/mybrand',
      'https://portaly.cc/mybrand',
    ])
  })

  it('filters out non-aggregator hosts', () => {
    const brand: LinkExpansionBrand = {
      website_url: 'https://mybrand.com',
      purchase_website: 'https://pinkoi.com/store/mybrand',
    }
    expect(collectHubUrls(brand)).toEqual([])
  })

  it('handles missing fields gracefully', () => {
    expect(collectHubUrls({})).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// unwrapRedirectWrapper
// ---------------------------------------------------------------------------
describe('unwrapRedirectWrapper', () => {
  it('extracts the target URL from a redirect wrapper', () => {
    const wrapped =
      'https://affsrc.com/track/clicks?t=https%3A%2F%2Fwww.pinkoi.com%2Fstore%2Fphenshyshy'
    expect(unwrapRedirectWrapper(wrapped)).toBe(
      'https://www.pinkoi.com/store/phenshyshy',
    )
  })

  it('returns the original URL when no param is a valid http URL', () => {
    expect(unwrapRedirectWrapper('https://mybrand.com/page?ref=abc')).toBe(
      'https://mybrand.com/page?ref=abc',
    )
  })

  it('picks the first http(s) param value when multiple exist', () => {
    const url =
      'https://aff.example/go?a=https%3A%2F%2Ffirst.com&b=https%3A%2F%2Fsecond.com'
    expect(unwrapRedirectWrapper(url)).toBe('https://first.com')
  })
})

// ---------------------------------------------------------------------------
// expandLinkHubs
// ---------------------------------------------------------------------------

/**
 * Minimal HTML fixture: a hub page with a myship link and an Instagram handle.
 */
const HUB_HTML = `
<html><body>
  <a href="https://myship.7-11.com.tw/general/detail/GM123456">MyShip</a>
  <a href="https://www.instagram.com/coolbrand/">IG</a>
  <a href="https://www.facebook.com/coolbrand">FB</a>
</body></html>
`

describe('expandLinkHubs', () => {
  const fetchHtml = vi.fn<(url: string) => Promise<string | null>>()

  it('hub page yields myship and instagram links', async () => {
    fetchHtml.mockResolvedValue(HUB_HTML)

    const result = await expandLinkHubs({
      brandName: 'coolbrand',
      hubUrls: ['https://linktr.ee/coolbrand'],
      confirmedHubUrls: new Set(['https://linktr.ee/coolbrand']),
      fetchHtml,
    })

    expect(result.hubsFetched).toBe(1)
    expect(result.adopted).toContainEqual(
      expect.objectContaining({ field: 'purchaseMyship' }),
    )
    expect(result.adopted).toContainEqual(
      expect.objectContaining({ field: 'socialInstagram' }),
    )
  })

  it('unwraps affiliate wrapper before classify', async () => {
    const affiliateHtml = `
    <html><body>
      <a href="https://affsrc.com/track/clicks?t=https%3A%2F%2Fwww.pinkoi.com%2Fstore%2Fphenshyshy">Buy</a>
    </body></html>
    `
    fetchHtml.mockResolvedValue(affiliateHtml)

    const result = await expandLinkHubs({
      brandName: 'phenshyshy',
      hubUrls: ['https://linktr.ee/phenshyshy'],
      confirmedHubUrls: new Set(['https://linktr.ee/phenshyshy']),
      fetchHtml,
    })

    const pinkoi = result.adopted.find((a) => a.field === 'purchasePinkoi')
    expect(pinkoi).toBeDefined()
    expect(pinkoi!.value).toBe(
      'https://www.pinkoi.com/store/phenshyshy',
    )
  })

  it('social handle failing brand-token gate is not adopted', async () => {
    const html = `
    <html><body>
      <a href="https://www.instagram.com/totallydifferent/">IG</a>
    </body></html>
    `
    fetchHtml.mockResolvedValue(html)

    const result = await expandLinkHubs({
      brandName: 'coolbrand',
      hubUrls: ['https://linktr.ee/coolbrand'],
      confirmedHubUrls: new Set(['https://linktr.ee/coolbrand']),
      fetchHtml,
    })

    const ig = result.adopted.find((a) => a.field === 'socialInstagram')
    expect(ig).toBeUndefined()
  })

  it('opaque marketplace link adopted when hub is confirmed', async () => {
    const html = `
    <html><body>
      <a href="https://s.shopee.tw/4VHrii96Af">Shopee</a>
    </body></html>
    `
    fetchHtml.mockResolvedValue(html)

    const result = await expandLinkHubs({
      brandName: 'mybrand',
      hubUrls: ['https://linktr.ee/mybrand'],
      confirmedHubUrls: new Set(['https://linktr.ee/mybrand']),
      fetchHtml,
    })

    const shopee = result.adopted.find((a) => a.field === 'purchaseShopee')
    expect(shopee).toBeDefined()
  })

  it('opaque marketplace link NOT adopted when hub is unconfirmed', async () => {
    const html = `
    <html><body>
      <a href="https://s.shopee.tw/4VHrii96Af">Shopee</a>
    </body></html>
    `
    fetchHtml.mockResolvedValue(html)

    // Use a brand name whose tokens do NOT match the hub URL path,
    // so linkIdentifiesBrand(hubUrl, tokens) returns false.
    const result = await expandLinkHubs({
      brandName: 'unrelated',
      hubUrls: ['https://linktr.ee/someotheraccount'],
      confirmedHubUrls: new Set(), // NOT confirmed
      fetchHtml,
    })

    const shopee = result.adopted.find((a) => a.field === 'purchaseShopee')
    expect(shopee).toBeUndefined()
    expect(result.gated).toContain('hub_unconfirmed:linktr.ee')
  })

  it('fetch failure counts hub but adopts nothing', async () => {
    fetchHtml.mockResolvedValue(null)

    const result = await expandLinkHubs({
      brandName: 'mybrand',
      hubUrls: ['https://linktr.ee/mybrand'],
      confirmedHubUrls: new Set(['https://linktr.ee/mybrand']),
      fetchHtml,
    })

    expect(result.hubsFetched).toBe(1)
    expect(result.adopted).toEqual([])
  })
})
