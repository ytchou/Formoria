import { describe, it, expect, vi, afterEach } from 'vitest'
import { classifyByDomain, detectInputType, isNonBrandSiteHost } from '../input-detector'

afterEach(() => vi.unstubAllGlobals())

function html(body: string) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
}

describe('classifyByDomain', () => {
  it('maps known hosts', () => {
    expect(classifyByDomain('https://www.instagram.com/brand')).toBe('social')
    expect(classifyByDomain('https://pinkoi.com/store/x')).toBe('e-commerce')
    expect(classifyByDomain('https://my-brand.com')).toBeNull()
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
  })
})

describe('isNonBrandSiteHost', () => {
  it.each([
    'https://www.instagram.com/brand',
    'https://www.threads.com/@brand',
    'https://www.threads.net/@brand',
    'https://shopee.tw/brand',
    'https://linktr.ee/brand',
    'https://bio.site/brand',
  ])('is true for the platform URL %s', (url) => {
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
