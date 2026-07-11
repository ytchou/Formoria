import { describe, it, expect, vi, afterEach } from 'vitest'
import { scrapeBrandUrls } from '../index'

afterEach(() => vi.unstubAllGlobals())

function page(body: string) {
  return new Response(`<html><head></head><body>${body}</body></html>`, {
    status: 200, headers: { 'content-type': 'text/html' },
  })
}

describe('SinglePageStrategy via scrapeBrandUrls', () => {
  it('extracts name + description from OG tags', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page(
      '<meta property=\"og:title\" content=\"Acme\"><meta property=\"og:description\" content=\"Made in Taiwan\"><a href=\"https://www.pinkoi.com/store/mybrand\">Pinkoi</a>'
    )))
    const { data: r } = await scrapeBrandUrls(['https://acme.tw'])
    expect(r.brandName).toBe('Acme')
    expect(r.description).toBe('Made in Taiwan')
    expect(r.purchasePinkoi).toBe('https://www.pinkoi.com/store/mybrand')
    expect(r.purchaseShopee).toBeNull()
    expect(r.purchaseWebsite).toBeNull()
  })
  it('rejects a logo og:image as the hero', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page(
      '<meta property=\"og:title\" content=\"Acme\"><meta property=\"og:image\" content=\"https://acme.tw/logo.png\">'
    )))
    const { data: r } = await scrapeBrandUrls(['https://acme.tw'])
    expect(r.heroImageUrl).toBeNull()
  })
  it('extracts JSON-LD product images', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page(
      '<meta property="og:title" content="Acme">' +
      '<script type="application/ld+json">{"@type":"Product","name":"Widget","image":["https://cdn.acme.tw/a.jpg","https://cdn.acme.tw/b.jpg"]}</script>'
    )))
    const { data: r } = await scrapeBrandUrls(['https://acme.tw'])
    expect(r.jsonLdImageUrls).toContain('https://cdn.acme.tw/a.jpg')
    expect(r.jsonLdImageUrls).toContain('https://cdn.acme.tw/b.jpg')
  })
  it('uses JSON-LD image as hero fallback when og:image is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page(
      '<meta property="og:title" content="Acme">' +
      '<script type="application/ld+json">{"@type":"Product","image":"https://cdn.acme.tw/hero.jpg"}</script>'
    )))
    const { data: r } = await scrapeBrandUrls(['https://acme.tw'])
    expect(r.heroImageUrl).toBe('https://cdn.acme.tw/hero.jpg')
  })
})
