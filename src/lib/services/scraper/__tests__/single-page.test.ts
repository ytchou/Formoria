import { describe, it, expect, vi, afterEach } from 'vitest'
import { scrapeBrandUrl } from '../index'

afterEach(() => vi.unstubAllGlobals())

function page(body: string) {
  return new Response(`<html><head></head><body>${body}</body></html>`, {
    status: 200, headers: { 'content-type': 'text/html' },
  })
}

describe('SinglePageStrategy via scrapeBrandUrl', () => {
  it('extracts name + description from OG tags', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page(
      '<meta property=\"og:title\" content=\"Acme\"><meta property=\"og:description\" content=\"Made in Taiwan\"><a href=\"https://www.pinkoi.com/store/mybrand\">Pinkoi</a>'
    )))
    const r = await scrapeBrandUrl('https://acme.tw')
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
    const r = await scrapeBrandUrl('https://acme.tw')
    expect(r.heroImageUrl).toBeNull()
  })
  it('no longer exposes brandHighlights', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(page('<title>X</title>')))
    const r = await scrapeBrandUrl('https://acme.tw')
    expect('brandHighlights' in r).toBe(false)
  })
})
