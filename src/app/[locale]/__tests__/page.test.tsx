// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import zh from '../../../../messages/zh-TW.json'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(),
  setRequestLocale: vi.fn(),
  getMessages: vi.fn().mockResolvedValue({}),
}))

vi.mock('next-intl', () => ({
  NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}))

vi.mock('@/lib/json-ld', () => ({
  buildWebSiteJsonLd: vi.fn(() => ({ '@context': 'https://schema.org' })),
  buildOrganizationJsonLd: vi.fn(() => ({
    '@context': 'https://schema.org',
    '@type': 'Organization',
  })),
  safeJsonLdStringify: vi.fn((data: Record<string, unknown>) =>
    JSON.stringify(data).replace(/</g, '\\u003c'),
  ),
}))

vi.mock('@/lib/seo/alternates', () => ({
  buildAlternates: vi.fn(() => ({
    canonical: 'https://example.com',
    languages: {
      en: 'https://example.com/en',
      'zh-TW': 'https://example.com/zh-TW',
    },
  })),
}))

vi.mock('@/lib/services/brands', () => ({
  EXPLORE_BRAND_LIMIT: 12,
  getExploreBrands: vi.fn(),
  getNewBrands: vi.fn(),
  getRecentBrandCount: vi.fn(),
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => <a href={href} {...props}>{children}</a>,
}))

vi.mock('@/components/landing/hero-section', () => ({
  default: () => <div data-testid="hero-section" />,
}))

vi.mock('@/components/landing/section-band', () => ({
  default: () => <div data-testid="section-band" />,
}))

vi.mock('@/hooks/use-saved-brands', () => ({
  SavedBrandsProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useSavedBrands: vi.fn(() => ({
    savedIds: new Set(),
    toggle: vi.fn(),
    loading: false,
  })),
}))

vi.mock('@/components/shared/brand-showcase', () => ({
  default: ({
    heading,
    subheading,
    brands,
    linkHref,
  }: {
    heading: string
    subheading?: string
    brands: Array<{ name: string }>
    linkHref: string
  }) => {
    if (brands.length === 0) return null

    return (
      <section data-testid="brand-showcase">
        <h2>{heading}</h2>
        {subheading ? <p>{subheading}</p> : null}
        <a href={linkHref}>{linkHref}</a>
        <div>{brands.map((brand) => brand.name).join(', ')}</div>
      </section>
    )
  },
}))

import { getTranslations } from 'next-intl/server'
import {
  getExploreBrands,
  getNewBrands,
  getRecentBrandCount,
} from '@/lib/services/brands'
import type { Brand } from '@/lib/types'
import LandingPage from '../page'

type Messages = typeof zh

// Minimal Translator stub — satisfies next-intl's Translator shape for type-checking purposes
type TranslatorStub = (key: string) => string

function makeT(messages: Messages, namespace: string): TranslatorStub {
  return (key: string) => {
    const parts = `${namespace}.${key}`.split('.')
    let value: unknown = messages

    for (const part of parts) {
      value = (value as Record<string, unknown>)?.[part]
    }

    return typeof value === 'string' ? value : key
  }
}

function createBrand(overrides: Partial<Brand>): Brand {
  return {
    id: 'brand-1',
    name: 'Brand',
    slug: 'brand',
    description: null,
    heroImageUrl: null,
    status: 'approved',
    category: null,
    city: null,
    isVerified: false,
    isDemo: false,
    foundingYear: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    otherUrls: [],
    retailLocations: [],
    productPhotos: [],
    contactEmail: null,
    siteContent: null,
    priceRange: null,
    productTags: [],
    productTagsEn: [],
    descriptionEn: null,
    blurb: null,
    blurbEn: null,
    imageAlts: [],
    submittedAt: '2026-01-01T00:00:00.000Z',
    approvedAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  }
}

describe('LandingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(getTranslations).mockImplementation(
      async (namespace: Parameters<typeof getTranslations>[0]) =>
        makeT(
          zh as Messages,
          typeof namespace === 'string' ? namespace : '',
        ) as ReturnType<typeof makeT> as unknown as Awaited<
          ReturnType<typeof getTranslations>
        >,
    )
    vi.mocked(getExploreBrands).mockResolvedValue({
      brands: [
        createBrand({
          id: 'verified-1',
          name: 'Verified Brand',
          isVerified: true,
        }),
        createBrand({
          id: 'community-1',
          name: 'Community Brand',
          isVerified: false,
        }),
      ],
      totalCount: 2,
    })
    vi.mocked(getNewBrands).mockResolvedValue([])
    vi.mocked(getRecentBrandCount).mockResolvedValue({
      count: 3,
      period: '7d',
    })
  })

  it('renders the landing page and fetches approved brands', async () => {
    render(await LandingPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))

    expect(screen.getByTestId('hero-section')).toBeInTheDocument()
    expect(screen.getByTestId('section-band')).toBeInTheDocument()
    expect(getExploreBrands).toHaveBeenCalledTimes(1)
    expect(getExploreBrands).toHaveBeenCalledWith(12)
    expect(screen.getByRole('heading', { name: '探索品牌' })).toBeInTheDocument()
  })

  it('keeps the newest brands section separate from the explore section', async () => {
    vi.mocked(getNewBrands).mockResolvedValue([
      createBrand({ id: 'newest-1', name: 'Newest Brand' }),
    ])

    render(await LandingPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))

    expect(screen.getAllByTestId('brand-showcase')).toHaveLength(2)
    expect(screen.getByRole('heading', { name: '最新品牌' })).toBeInTheDocument()
  })

  it('keeps rendering when landing page brand queries fail', async () => {
    const databaseError = new Error('Supabase project restricted')
    vi.mocked(getExploreBrands).mockRejectedValue(databaseError)
    vi.mocked(getNewBrands).mockRejectedValue(databaseError)
    vi.mocked(getRecentBrandCount).mockRejectedValue(databaseError)

    render(await LandingPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))

    expect(screen.getByTestId('hero-section')).toBeInTheDocument()
    expect(screen.getByTestId('section-band')).toBeInTheDocument()
    expect(screen.queryByTestId('brand-showcase')).not.toBeInTheDocument()
  })
})
