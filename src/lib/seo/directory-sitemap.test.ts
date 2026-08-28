import { describe, expect, it } from 'vitest'
import type { BrandSeoEntry } from '@/lib/services/brands'
import { getSiteUrl } from './site-url'
import {
  buildDirectorySitemapEntries,
  buildDirectorySitemapSection,
} from './directory-sitemap'

function brand(overrides: Partial<BrandSeoEntry> = {}): BrandSeoEntry {
  return {
    slug: 'sample-brand',
    updatedAt: '2026-01-01T00:00:00.000Z',
    categorySlug: 'home',
    // Slugs, not zh-TW labels: `brands.subcategories` stores English slugs
    // since DEV-1510 task 9.
    subcategories: ['furniture'],
    description: null,
    descriptionEn: null,
    blurbEn: null,
    seoPromoted: false,
    ...overrides,
  }
}

describe('buildDirectorySitemapEntries', () => {
  it('emits eligible L1 and L2 targets while excluding deferred taxonomy', () => {
    const entries = buildDirectorySitemapEntries([brand()])
    const urls = entries.map((entry) => entry.url)
    const base = getSiteUrl()

    expect(urls).toContain(`${base}/brands?category=home`)
    expect(urls).toContain(`${base}/brands?category=home&sub=furniture`)
    expect(urls.some((url) => url.includes('category=tech'))).toBe(false)
    expect(urls.some((url) => url.endsWith('/outdoor-accessories'))).toBe(false)
  })

  it('emits only clean taxonomy paths without facets, sorting, or pagination', () => {
    const entries = buildDirectorySitemapEntries([brand()])

    expect(entries.every((entry) => !/[?&](search|price|verification|sort|page)=/.test(entry.url))).toBe(true)
    expect(entries.every((entry) => entry.url.includes('/brands?category='))).toBe(true)
  })

  it('attaches reciprocal locale alternates to every taxonomy entry', () => {
    const entries = buildDirectorySitemapEntries([brand()])

    for (const entry of entries) {
      expect(entry.alternates?.languages).toMatchObject({
        'zh-TW': expect.any(String),
        en: expect.any(String),
      })
    }
  })

  it('uses the newest approved brand date for each taxonomy', () => {
    const entries = buildDirectorySitemapEntries([
      brand({ slug: 'older', updatedAt: '2026-01-01T00:00:00.000Z' }),
      brand({ slug: 'newer', updatedAt: '2026-04-12T00:00:00.000Z' }),
    ])
    const furniture = entries.find((entry) => entry.url.endsWith('/brands?category=home&sub=furniture'))

    expect(furniture?.lastModified).toEqual(new Date('2026-04-12T00:00:00.000Z'))
  })

  it('dates an L2 entry from a cross-L1 brand while leaving the L1 entry alone', () => {
    // The L2 target lists by tag alone, so a brand whose own L1 differs counts
    // toward `/brands?category=home&sub=furniture` — and must not leak into
    // `/brands?category=home`, which lists by category (DEV-1510).
    const entries = buildDirectorySitemapEntries([
      brand({ slug: 'native', updatedAt: '2026-01-01T00:00:00.000Z' }),
      brand({
        slug: 'cross-l1',
        categorySlug: 'stationery',
        subcategories: ['furniture'],
        updatedAt: '2026-05-20T00:00:00.000Z',
      }),
    ])

    expect(
      entries.find((entry) => entry.url.endsWith('/brands?category=home&sub=furniture'))?.lastModified,
    ).toEqual(new Date('2026-05-20T00:00:00.000Z'))
    expect(
      entries.find((entry) => entry.url.endsWith('/brands?category=home'))?.lastModified,
    ).toEqual(new Date('2026-01-01T00:00:00.000Z'))
  })

  it('keeps the directory failure isolated from brand and story sections', async () => {
    const rawBrandsPromise = Promise.reject<ReadonlyArray<BrandSeoEntry>>(
      new Error('directory data unavailable'),
    )
    const [brands, directory] = await Promise.all([
      rawBrandsPromise.catch(() => []),
      buildDirectorySitemapSection(rawBrandsPromise),
    ])
    const brandPages = [{ url: '/brands/sample-brand' }]
    const storyPages = [{ url: '/stories/sample-story' }]

    expect(brands).toEqual([])
    expect(directory).toEqual([])
    expect([...brands, ...directory, ...brandPages, ...storyPages]).toEqual([
      { url: '/brands/sample-brand' },
      { url: '/stories/sample-story' },
    ])
  })
})
