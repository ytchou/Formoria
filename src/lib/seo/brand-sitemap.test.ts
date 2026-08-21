import { describe, expect, it } from 'vitest'
import type { BrandSeoEntry } from '@/lib/services/brands'
import { localizedEntries } from '@/app/sitemap'
import { getSiteUrl } from './site-url'
import { buildBrandSitemapEntries } from './brand-sitemap'

const base = getSiteUrl()

function brand(overrides: Partial<BrandSeoEntry> = {}): BrandSeoEntry {
  return {
    slug: 'sample-brand',
    updatedAt: '2026-01-01T00:00:00.000Z',
    categorySlug: 'home',
    subcategories: ['家具'],
    description: '以台灣日常生活為靈感，設計耐用而實用的居家用品。',
    descriptionEn:
      'A Taiwanese studio creating practical home goods with carefully selected materials for everyday living.',
    blurbEn: 'Practical Taiwanese home goods made with selected materials.',
    seoPromoted: true,
    ...overrides,
  }
}

describe('localizedEntries', () => {
  it('defaults hreflang to the emitted locales', () => {
    const [zh] = localizedEntries('/brands/acme', ['zh-TW'])

    expect(zh.url).toBe(`${base}/brands/acme`)
    expect(zh.alternates?.languages ?? {}).not.toHaveProperty('en')
  })

  it('keeps hreflang wider than the emitted set when alternates are passed', () => {
    const entries = localizedEntries('/brands/acme', ['zh-TW'], undefined, [
      'zh-TW',
      'en',
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0].url).toBe(`${base}/brands/acme`)
    expect(entries[0].alternates?.languages).toMatchObject({
      en: `${base}/en/brands/acme`,
    })
  })
})

describe('buildBrandSitemapEntries', () => {
  it('submits both locales for a promoted brand with valid English', () => {
    const urls = buildBrandSitemapEntries([brand({ slug: 'acme' })]).map(
      (entry) => entry.url,
    )

    expect(urls).toEqual([`${base}/brands/acme`, `${base}/en/brands/acme`])
  })

  it('omits a brand that fails the promotion bar', () => {
    expect(
      buildBrandSitemapEntries([brand({ slug: 'thin', seoPromoted: false })]),
    ).toEqual([])
  })

  it('omits one brand without narrowing another', () => {
    const urls = buildBrandSitemapEntries([
      brand({ slug: 'thin', seoPromoted: false }),
      brand({ slug: 'deep' }),
    ]).map((entry) => entry.url)

    expect(urls).toEqual([`${base}/brands/deep`, `${base}/en/brands/deep`])
  })

  it('submits zh-TW only when English copy fails purity, and drops en from hreflang', () => {
    const entries = buildBrandSitemapEntries([
      brand({ slug: 'zh-only', descriptionEn: '這仍然是中文內容，不是英文。' }),
    ])

    expect(entries.map((entry) => entry.url)).toEqual([
      `${base}/brands/zh-only`,
    ])
    // en has no real page here, so hreflang must not advertise one.
    expect(entries[0].alternates?.languages ?? {}).not.toHaveProperty('en')
  })

  it('keeps advertising en when the page exists, even as membership narrows', () => {
    // The case the two-bar split exists for. Indexability says both locales have
    // pages; hreflang must keep saying so, because the brand detail page derives
    // its own alternates from that same bar. If membership narrowed hreflang
    // too, the sitemap and the page would contradict each other.
    const entries = buildBrandSitemapEntries([brand({ slug: 'acme' })])
    const zh = entries.find((entry) => entry.url === `${base}/brands/acme`)

    expect(zh?.alternates?.languages).toMatchObject({
      'zh-TW': `${base}/brands/acme`,
      en: `${base}/en/brands/acme`,
    })
  })

  it('never emits a locale that has no page', () => {
    const entries = buildBrandSitemapEntries([
      brand({ slug: 'no-en', descriptionEn: null, blurbEn: null }),
    ])

    expect(entries.map((entry) => entry.url)).toEqual([`${base}/brands/no-en`])
  })

  it('carries lastModified through and tolerates an unparseable timestamp', () => {
    const [withDate] = buildBrandSitemapEntries([brand({ slug: 'dated' })])
    expect(withDate.lastModified).toEqual(new Date('2026-01-01T00:00:00.000Z'))

    const [noDate] = buildBrandSitemapEntries([
      brand({ slug: 'bad-date', updatedAt: 'not-a-date' }),
    ])
    expect(noDate.lastModified).toBeUndefined()
  })

  it('emits nothing for an empty corpus', () => {
    expect(buildBrandSitemapEntries([])).toEqual([])
  })
})
