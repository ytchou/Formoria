import { describe, expect, it, vi } from 'vitest'
import {
  collectHubUrls,
  computeEvidence,
  deriveThreadsUrl,
  expandLinkHubs,
  expandThreadsBio,
  hasPurchaseChannel,
  unwrapRedirectWrapper,
  type LinkExpansionBrand,
} from '../link-expansion'
import type { FetchMetadata } from '../scraper/fetch-guards'

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
    expect(unwrapRedirectWrapper(url)).toBe('https://first.com/')
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

// ---------------------------------------------------------------------------
// deriveThreadsUrl
// ---------------------------------------------------------------------------
describe('deriveThreadsUrl', () => {
  it('derive_threads_url_from_instagram_profile', () => {
    expect(deriveThreadsUrl('https://www.instagram.com/1.wo_of/')).toBe(
      'https://www.threads.com/@1.wo_of',
    )
    expect(deriveThreadsUrl('https://instagram.com/coolbrand')).toBe(
      'https://www.threads.com/@coolbrand',
    )
    // A post permalink is not a profile — deriving a handle from it would send
    // every visitor to one photo's author slot.
    expect(deriveThreadsUrl('https://www.instagram.com/p/DQeL94sEv9G/')).toBeNull()
    expect(deriveThreadsUrl('https://www.instagram.com/coolbrand/reel/123/')).toBeNull()
    expect(deriveThreadsUrl(null)).toBeNull()
    expect(deriveThreadsUrl(undefined)).toBeNull()
    expect(deriveThreadsUrl('https://example.com/coolbrand')).toBeNull()
    // A look-alike host is not Instagram: deriving from it would fetch a
    // stranger's Threads page.
    expect(deriveThreadsUrl('https://not-instagram.com/someuser/')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// expandThreadsBio
// ---------------------------------------------------------------------------

function meta(over: Partial<FetchMetadata>): FetchMetadata {
  return { text: null, status: null, latencyMs: 5, error: null, ...over }
}

function threadsPage(body: string): string {
  return `<html><head>${body}</head><body></body></html>`
}

const THREADS_URL = 'https://www.threads.com/@coolbrand'

function runThreadsBio(over: {
  brandName?: string | null
  metadata: FetchMetadata
  fetchHtml?: (url: string) => Promise<string | null>
}) {
  return expandThreadsBio({
    brandName: over.brandName === undefined ? 'coolbrand' : over.brandName,
    threadsUrl: THREADS_URL,
    confirmedHubUrls: new Set<string>(),
    fetchHtmlWithMetadata: vi.fn(async () => over.metadata),
    fetchHtml: over.fetchHtml ?? vi.fn(async () => null),
  })
}

describe('expandThreadsBio', () => {
  it('threads_rel_me_marketplace_link_adopted_as_purchase_channel', async () => {
    const html = threadsPage(
      '<link rel="me" href="https://myship.7-11.com.tw/general/detail/GM123">',
    )

    const result = await runThreadsBio({
      metadata: meta({ text: html, status: 200 }),
    })

    expect(result.threads).toBe('found')
    expect(result.relMeUrl).toBe('https://myship.7-11.com.tw/general/detail/GM123')
    expect(result.adopted).toContainEqual(
      expect.objectContaining({ field: 'purchaseMyship', source: 'threads' }),
    )
    expect(result.scraped.purchaseMyship).toBe(
      'https://myship.7-11.com.tw/general/detail/GM123',
    )
  })

  it('threads_rel_me_aggregator_is_expanded_as_confirmed_hub', async () => {
    const html = threadsPage('<link rel="me" href="https://linktr.ee/x">')
    const hubHtml = `
    <html><body>
      <a href="https://www.pinkoi.com/store/coolbrandstore">Pinkoi</a>
    </body></html>
    `

    const result = await expandThreadsBio({
      brandName: 'coolbrand',
      threadsUrl: THREADS_URL,
      confirmedHubUrls: new Set<string>(),
      fetchHtmlWithMetadata: vi.fn(async () => meta({ text: html, status: 200 })),
      fetchHtml: vi.fn(async () => hubHtml),
    })

    expect(result.threads).toBe('found')
    expect(result.hubUrls).toContain('https://linktr.ee/x')
    const pinkoi = result.adopted.find((a) => a.field === 'purchasePinkoi')
    expect(pinkoi).toBeDefined()
    expect(pinkoi!.source).toBe('threads')
    expect(result.scraped.purchasePinkoi).toBe(
      'https://www.pinkoi.com/store/coolbrandstore',
    )
  })

  it('threads_page_without_rel_me_is_absent', async () => {
    const result = await runThreadsBio({
      metadata: meta({
        text: threadsPage('<title>coolbrand on Threads</title>'),
        status: 200,
      }),
    })

    expect(result.threads).toBe('absent')
    expect(result.adopted).toEqual([])
    expect(result.hubUrls).toEqual([])
  })

  it('threads_join_landing_is_absent', async () => {
    const html = threadsPage(
      '<meta property="og:description" content="Join Threads to share ideas, ask questions, post random thoughts.">' +
        '<link rel="me" href="https://myship.7-11.com.tw/general/detail/GM999">',
    )

    const result = await runThreadsBio({
      metadata: meta({ text: html, status: 200 }),
    })

    // The landing page belongs to the platform, not the brand: anything it
    // carries would be adopted for a handle that does not exist.
    expect(result.threads).toBe('absent')
    expect(result.adopted).toEqual([])
  })

  it('threads_fetch_timeout_is_unknown', async () => {
    const result = await runThreadsBio({
      metadata: meta({ text: null, status: null, error: 'timeout' }),
    })

    expect(result.threads).toBe('unknown')
    expect(result.adopted).toEqual([])
  })

  it('threads_http_429_is_unknown_and_404_is_absent', async () => {
    const throttled = await runThreadsBio({
      metadata: meta({ text: null, status: 429, error: 'http_error' }),
    })
    expect(throttled.threads).toBe('unknown')

    const missing = await runThreadsBio({
      metadata: meta({ text: null, status: 404, error: 'http_error' }),
    })
    expect(missing.threads).toBe('absent')
  })

  it('threads_http_500_is_unknown', async () => {
    const result = await runThreadsBio({
      metadata: meta({ text: null, status: 500, error: 'http_error' }),
    })

    expect(result.threads).toBe('unknown')
  })

  it('threads_rel_me_social_still_passes_handle_gate', async () => {
    const html = threadsPage('<link rel="me" href="https://linktr.ee/x">')
    const hubHtml = `
    <html><body>
      <a href="https://www.instagram.com/otherbrand/">IG</a>
    </body></html>
    `

    const result = await expandThreadsBio({
      brandName: 'coolbrand',
      threadsUrl: THREADS_URL,
      confirmedHubUrls: new Set<string>(),
      fetchHtmlWithMetadata: vi.fn(async () => meta({ text: html, status: 200 })),
      fetchHtml: vi.fn(async () => hubHtml),
    })

    expect(
      result.adopted.find((a) => a.field === 'socialInstagram'),
    ).toBeUndefined()
    expect(result.scraped.socialInstagram).toBeUndefined()
  })

  it('a direct social rel=me is gated by the brand-token check', async () => {
    const html = threadsPage(
      '<link rel="me" href="https://www.instagram.com/otherbrand/">',
    )

    const result = await runThreadsBio({
      metadata: meta({ text: html, status: 200 }),
    })

    expect(result.adopted).toEqual([])
    expect(result.threads).toBe('absent')
  })

  it('a hub fetch failure behind rel=me reads as unknown, never absent', async () => {
    const html = threadsPage('<link rel="me" href="https://linktr.ee/x">')

    const result = await expandThreadsBio({
      brandName: 'coolbrand',
      threadsUrl: THREADS_URL,
      confirmedHubUrls: new Set<string>(),
      fetchHtmlWithMetadata: vi.fn(async () => meta({ text: html, status: 200 })),
      fetchHtml: vi.fn(async () => null),
    })

    expect(result.threads).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// expandLinkHubs fetch-failure counter
// ---------------------------------------------------------------------------
describe('expandLinkHubs fetchFailures', () => {
  it('counts a null fetch as a failure and a served page as none', async () => {
    const failing = await expandLinkHubs({
      brandName: 'mybrand',
      hubUrls: ['https://linktr.ee/mybrand'],
      confirmedHubUrls: new Set(['https://linktr.ee/mybrand']),
      fetchHtml: vi.fn(async () => null),
    })
    expect(failing.fetchFailures).toBe(1)

    const served = await expandLinkHubs({
      brandName: 'coolbrand',
      hubUrls: ['https://linktr.ee/coolbrand'],
      confirmedHubUrls: new Set(['https://linktr.ee/coolbrand']),
      fetchHtml: vi.fn(async () => HUB_HTML),
    })
    expect(served.fetchFailures).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// computeEvidence
// ---------------------------------------------------------------------------
describe('computeEvidence', () => {
  const answered = {
    hubs: 'skipped',
    threads: 'absent',
    serpName: 'absent',
    serpHandle: 'absent',
  } as const

  it('is conclusive when every source answered and no call failed', () => {
    expect(computeEvidence(answered, ['succeeded'])).toBe('conclusive')
    expect(computeEvidence(answered, [])).toBe('conclusive')
  })

  it('is inconclusive when any source is unknown', () => {
    expect(
      computeEvidence({ ...answered, threads: 'unknown' }, ['succeeded']),
    ).toBe('inconclusive')
  })

  it('is inconclusive when a source is missing entirely', () => {
    expect(computeEvidence({ hubs: 'skipped', threads: 'absent' }, [])).toBe(
      'inconclusive',
    )
    expect(computeEvidence(undefined, [])).toBe('inconclusive')
  })

  it('is inconclusive when a recorded search call did not succeed', () => {
    expect(computeEvidence(answered, ['failed'])).toBe('inconclusive')
    expect(computeEvidence(answered, ['succeeded', 'timeout'])).toBe(
      'inconclusive',
    )
    // A source never consulted records no call status at all.
    expect(computeEvidence(answered, ['succeeded', null, undefined])).toBe(
      'conclusive',
    )
  })
})
