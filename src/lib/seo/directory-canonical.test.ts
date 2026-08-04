import { describe, expect, it } from 'vitest'
import { buildDirectoryCanonicals } from './directory-canonical'
import { getSiteUrl } from './site-url'

describe('buildDirectoryCanonicals', () => {
  it('puts category before page and propagates both to hreflang URLs', () => {
    const result = buildDirectoryCanonicals({
      locale: 'en',
      categorySlug: 'fashion',
      page: 2,
    })
    const base = getSiteUrl()

    expect(result.canonical).toBe(`${base}/en/brands?category=fashion&page=2`)
    expect(result.languages).toEqual({
      'zh-TW': `${base}/brands?category=fashion&page=2`,
      en: `${base}/en/brands?category=fashion&page=2`,
      'x-default': `${base}/brands?category=fashion&page=2`,
    })
  })

  it('omits the page query for the first directory page', () => {
    const result = buildDirectoryCanonicals({
      locale: 'zh-TW',
      page: 1,
    })

    expect(result.canonical).toBe(`${getSiteUrl()}/brands`)
    expect(result.languages['en']).toBe(`${getSiteUrl()}/en/brands`)
  })
})
