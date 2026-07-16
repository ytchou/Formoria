// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl/server', () => {
  const makeTranslations = (namespace: string) => {
    const translate = ((key: string, values?: Record<string, unknown>) =>
      namespace === 'brands' && key === 'heading'
        ? 'Made in Taiwan Brand Directory'
        : namespace === 'brands' && key === 'metadata.title'
          ? 'Formoria — 台灣品牌目錄'
          : namespace === 'brands' && key === 'metadata.description'
            ? '探索精選的台灣品牌，依分類瀏覽、搜尋，發現最值得支持的台灣製造品牌。'
            : namespace === 'categories' && key === 'metadata.title'
              ? `${values?.displayName} Brands from Taiwan`
              : namespace === 'categories' && key === 'metadata.description'
                ? 'A'.repeat(435)
                : namespace === 'categories' && key === 'subMetadata.title'
                  ? `Made in Taiwan ${values?.subName} Brands | ${values?.categoryName} | MIT Map`
                  : namespace === 'categories' && key === 'subMetadata.description'
                    ? `Discover Made in Taiwan ${values?.subName} brands in ${values?.categoryName}.`
                    : key) as ((key: string, values?: Record<string, unknown>) => string) & {
      has: (key: string) => boolean
    }
    translate.has = () => false
    return translate
  }

  return {
    getMessages: vi.fn(async () => ({})),
    getTranslations: vi.fn(async (namespace: string) => makeTranslations(namespace)),
    setRequestLocale: vi.fn(),
  }
})

vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/lib/services/brands', () => ({
  getBrands: vi.fn(async () => ({ brands: [], totalCount: 0 })),
  getFeaturedBrands: vi.fn(async () => []),
  getPopularCategories: vi.fn(async () => []),
  getSubcategoryCounts: vi.fn(async () => new Map()),
}))

vi.mock('@/lib/services/app-settings', () => ({
  SUBCATEGORY_FILTER_KEY: 'subcategory_filter_enabled',
  getAppSetting: vi.fn(async () => true),
}))

vi.mock('@/lib/json-ld', () => ({
  buildBreadcrumbJsonLd: vi.fn(() => ({})),
  buildBrandsItemListJsonLd: vi.fn(() => ({})),
  buildCategoryItemListJsonLd: vi.fn(() => ({})),
  buildWebSiteJsonLd: vi.fn(() => ({})),
  safeJsonLdStringify: vi.fn(() => '{}'),
}))

vi.mock('@/components/brands/brand-filter-sidebar', () => ({
  BrandFilterDrawer: () => null,
  BrandFilterSidebar: () => null,
}))
vi.mock('@/components/brands/brand-card', () => ({ BrandCard: () => null }))
vi.mock('@/components/brands/masonry-grid', () => ({
  MasonryGrid: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/brands/pagination', () => ({ Pagination: () => null }))
vi.mock('@/components/brands/search-empty-state-wrapper', () => ({
  SearchEmptyStateWrapper: () => null,
}))
vi.mock('@/components/brands/sort-select', () => ({ SortSelect: () => null }))
vi.mock('@/components/analytics/view-item-list-tracker', () => ({
  ViewItemListTracker: () => null,
}))
vi.mock('@/components/ui/card', () => ({ surfaceCardStyles: vi.fn(() => '') }))
vi.mock('@/hooks/use-saved-brands', () => ({
  SavedBrandsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

import BrandsPage, { generateMetadata } from './page'

const pageProps = (locale: string, searchParams: Record<string, string> = {}) => ({
  params: Promise.resolve({ locale }),
  searchParams: Promise.resolve(searchParams),
})

describe('brands directory headings', () => {
  it('renders a page-level heading for the base directory', async () => {
    render(await BrandsPage(pageProps('en')))

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Made in Taiwan Brand Directory',
    })).toBeInTheDocument()
  })

  it('renders the selected category as the page-level heading', async () => {
    render(await BrandsPage(pageProps('en', { category: 'outdoor' })))

    expect(screen.getByRole('heading', {
      level: 1,
      name: 'Outdoor & Camping',
    })).toBeInTheDocument()
  })

  it('truncates category metadata descriptions to the meta limit', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({ category: 'outdoor' }),
    })

    expect(metadata.description).toHaveLength(156)
  })

  it('uses localized base metadata for the zh-TW directory', async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: 'zh-TW' }),
      searchParams: Promise.resolve({}),
    })

    expect(metadata.title).toEqual({ absolute: 'Formoria — 台灣品牌目錄' })
    expect(metadata.description).toBe('探索精選的台灣品牌，依分類瀏覽、搜尋，發現最值得支持的台灣製造品牌。')
  })
})

describe('generateMetadata with ?sub=', () => {
  it('uses subcategory metadata and the parent category canonical for one category and one subcategory', async () => {
    const metadata = await generateMetadata(pageProps('en', {
      category: 'outdoor',
      sub: 'hiking-and-camping-gear',
    }))

    expect(metadata.title).toBe(
      'Made in Taiwan Hiking & Camping Gear Brands | Outdoor & Camping | MIT Map'
    )
    expect(metadata.alternates?.canonical).toContain('/en/brands?category=outdoor')
    expect(metadata.alternates?.canonical).not.toContain('sub=')
  })

  it('falls back to category metadata when multiple subcategories are active', async () => {
    const metadata = await generateMetadata(pageProps('en', {
      category: 'outdoor',
      sub: 'hiking-and-camping-gear,picnic-supplies',
    }))

    expect(metadata.title).toBe('Outdoor & Camping Brands from Taiwan')
    expect(metadata.alternates?.canonical).not.toContain('sub=')
  })

  it('ignores subcategories without a single category', async () => {
    const metadata = await generateMetadata(pageProps('en', {
      sub: 'hiking-and-camping-gear',
    }))

    expect(metadata.title).toEqual({ absolute: 'Formoria — 台灣品牌目錄' })
    expect(metadata.alternates?.canonical).not.toContain('sub=')
  })
})
