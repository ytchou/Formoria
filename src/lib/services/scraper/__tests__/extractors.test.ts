import { describe, it, expect } from 'vitest'
import * as cheerio from 'cheerio'
import { filterHeroImage, extractSocialLinks, emptyResult } from '../parse/extractors'

describe('filterHeroImage', () => {
  it('rejects a logo/icon hero and keeps a real product hero', () => {
    expect(filterHeroImage('https://cdn.site.com/assets/logo.png', 'https://site.com')).toBeNull()
    expect(filterHeroImage('/img/hero-product.jpg', 'https://site.com')).toBe('https://site.com/img/hero-product.jpg')
  })
})

describe('extractSocialLinks', () => {
  it('pulls instagram + facebook hrefs', () => {
    const $ = cheerio.load('<a href="https://instagram.com/brand">ig</a><a href="https://facebook.com/brand">fb</a>')
    const links = extractSocialLinks($)
    expect(links.socialInstagram).toContain('instagram.com/brand')
    expect(links.socialFacebook).toContain('facebook.com/brand')
  })
})

describe('emptyResult', () => {
  it('returns a null-filled ScrapedBrandData with the source url and no brandHighlights', () => {
    const r = emptyResult('https://site.com')
    expect(r.brandName).toBeNull()
    expect('brandHighlights' in r).toBe(false)
    expect(r.story).toBeNull()
  })
})
