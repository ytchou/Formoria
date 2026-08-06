import { describe, expect, it } from 'vitest'
import { buildDirectoryCanonicals } from './directory-canonical'
import { getSiteUrl } from './site-url'

describe('buildDirectoryCanonicals', () => {
  it('builds a path canonical for an L1 target', () => {
    const result = buildDirectoryCanonicals({
      locale: 'zh-TW',
      categorySlug: 'home',
    })
    const base = getSiteUrl()

    expect(result.canonical).toBe(`${base}/categories/home`)
    expect(result.languages.en).toBe(`${base}/en/categories/home`)
  })

  it('builds a path canonical for an L2 target', () => {
    const result = buildDirectoryCanonicals({
      locale: 'en',
      categorySlug: 'home',
      subcategorySlug: 'furniture',
    })
    const base = getSiteUrl()

    expect(result.canonical).toBe(`${base}/en/categories/home/furniture`)
    expect(result.languages['zh-TW']).toBe(`${base}/categories/home/furniture`)
    expect(result.languages['x-default']).toBe(`${base}/categories/home/furniture`)
  })

  it('retains page on page 2 and omits it on page 1', () => {
    const pageTwo = buildDirectoryCanonicals({
      locale: 'zh-TW',
      categorySlug: 'home',
      page: 2,
    })
    const pageOne = buildDirectoryCanonicals({
      locale: 'zh-TW',
      categorySlug: 'home',
      page: 1,
    })
    const base = getSiteUrl()

    expect(pageTwo.canonical).toBe(`${base}/categories/home?page=2`)
    expect(pageTwo.languages.en).toBe(`${base}/en/categories/home?page=2`)
    expect(pageOne.canonical).toBe(`${base}/categories/home`)
    expect(pageOne.languages.en).toBe(`${base}/en/categories/home`)
  })

  it('strips sort and all facets', () => {
    const result = buildDirectoryCanonicals({
      locale: 'en',
      categorySlug: 'home',
      subcategorySlug: 'furniture',
      page: 2,
    })

    for (const url of [result.canonical, ...Object.values(result.languages)]) {
      expect(url).not.toMatch(/[?&](sort|search|price|verification|sub)=/)
      expect(url).toContain('/categories/home/furniture')
      expect(url).toContain('page=2')
    }
  })

  it('keeps the /brands form when no category is given', () => {
    const result = buildDirectoryCanonicals({
      locale: 'zh-TW',
      page: 1,
    })

    expect(result.canonical).toBe(`${getSiteUrl()}/brands`)
    expect(result.languages['en']).toBe(`${getSiteUrl()}/en/brands`)
  })
})
