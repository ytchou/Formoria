import { describe, expect, it } from 'vitest'
import type { BrandSeoEntry } from '@/lib/services/brands'
import {
  DEFERRED_CATEGORY_SLUGS,
  VISIBLE_L1_CATEGORIES,
  resolveDirectorySubcategorySlugs,
} from '@/lib/taxonomy/ontology'
import type { Locale } from './alternates'
import {
  hasDeferredCategoryFilter,
  hasInvalidCategoryFilter,
  parseDirectoryViewFilters,
  type DirectorySearchParams,
} from './directory-filters'
import { listIndexableTargets, resolveDirectorySeo } from './directory-indexation'
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
    for (const slug of DEFERRED_CATEGORY_SLUGS) {
      expect(urls.some((url) => url.includes(`category=${slug}`))).toBe(false)
    }
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

  // One verdict: every submitted URL must be indexable and self-canonical when
  // `resolveDirectorySeo` sees it with the exact state `brands/page.tsx` builds
  // from that URL. This is the test that would have caught SP-03.
  it('submits only URLs the /brands page itself indexes, each self-canonical', () => {
    const entries = buildDirectorySitemapEntries([brand()])
    const base = getSiteUrl()
    const validCategorySlugs = new Set(VISIBLE_L1_CATEGORIES.map((category) => category.slug))

    expect(entries.length).toBeGreaterThan(0)
    // The page gate agrees with every launch target, so none is dropped: a
    // shortfall here means the keyword map and the page disagree.
    expect(entries).toHaveLength(listIndexableTargets().length * 2)
    for (const entry of entries) {
      const url = new URL(entry.url)
      expect(`${url.origin}`).toBe(new URL(base).origin)
      const locale: Locale = url.pathname.startsWith('/en/') ? 'en' : 'zh-TW'
      const sp: DirectorySearchParams = {
        category: url.searchParams.get('category') ?? undefined,
        sub: url.searchParams.get('sub') ?? undefined,
      }

      // Mirrors `generateMetadata` in src/app/[locale]/(site)/brands/page.tsx.
      expect(hasDeferredCategoryFilter(sp.category), entry.url).toBe(false)
      expect(hasInvalidCategoryFilter(sp.category, validCategorySlugs), entry.url).toBe(false)
      const { filters, page } = parseDirectoryViewFilters(sp, validCategorySlugs)
      const categorySlug =
        filters.categorySlugs.length === 1 ? (filters.categorySlugs[0] ?? null) : null
      const subcategories = resolveDirectorySubcategorySlugs(filters.subcategorySlugs)
      const activeSubcategory = subcategories.length === 1 ? subcategories[0] : undefined
      const seo = resolveDirectorySeo({
        locale,
        surface: 'brands',
        categorySlug,
        subcategorySlug: activeSubcategory?.slug,
        page,
        facets: {
          search: sp.search,
          sort: typeof sp.sort === 'string' ? sp.sort : undefined,
          category: sp.category,
          sub: sp.sub,
          multiCategory: filters.categorySlugs.length > 1,
          multiSub: filters.subcategorySlugs.length > 1,
        },
      })

      expect(seo.robots?.index, entry.url).not.toBe(false)
      expect(seo.canonical, entry.url).toBe(entry.url)
    }
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
