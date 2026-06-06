// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(),
  setRequestLocale: vi.fn(),
}))

vi.mock('@/lib/json-ld', () => ({
  buildWebSiteJsonLd: vi.fn(() => ({ '@context': 'https://schema.org' })),
}))

vi.mock('@/lib/seo/alternates', () => ({
  buildAlternates: vi.fn(() => ({
    canonical: 'https://example.com',
    languages: { en: 'https://example.com/en', 'zh-TW': 'https://example.com/zh-TW' },
  })),
}))

vi.mock('@/lib/services/brands', () => ({
  getBrandStats: vi.fn(),
  getBrands: vi.fn(),
  getNewBrands: vi.fn(),
}))

vi.mock('@/lib/services/taxonomy', () => ({
  getActiveCategories: vi.fn(),
  getValueTagsWithCoverage: vi.fn(),
}))

vi.mock('@/components/landing/hero-section', () => ({
  default: () => <div data-testid="hero-section" />,
}))

vi.mock('@/components/landing/trust-bar', () => ({
  default: () => <div data-testid="trust-bar" />,
}))

vi.mock('@/components/landing/manifesto', () => ({
  default: () => <div data-testid="manifesto" />,
}))

vi.mock('@/components/landing/value-chips', () => ({
  default: () => <div data-testid="value-chips" />,
}))

vi.mock('@/components/landing/dual-cta', () => ({
  default: () => <div data-testid="dual-cta" />,
}))

vi.mock('@/components/landing/filterable-brand-showcase', () => ({
  default: () => <div data-testid="filterable-brand-showcase" />,
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
import { getBrandStats, getBrands, getNewBrands } from '@/lib/services/brands'
import { getActiveCategories, getValueTagsWithCoverage } from '@/lib/services/taxonomy'
import type { Brand } from '@/lib/types'
import LandingPage from '../page'

function createBrand(overrides: Partial<Brand>): Brand {
  return {
    id: 'brand-1',
    name: 'Brand',
    slug: 'brand',
    description: null,
    logoUrl: null,
    heroImageUrl: null,
    status: 'approved',
    category: null,
    isVerified: false,
    isDemo: false,
    foundingYear: null,
    purchaseLinks: [],
    socialLinks: {},
    retailLocations: [],
    productPhotos: [],
    contactEmail: null,
    brandHighlights: null,
    tags: [],
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getTranslations).mockImplementation((async () => ((key: string) => key)) as any)
    vi.mocked(getBrandStats).mockResolvedValue({
      brandCount: 12,
      categoryCount: 4,
    })
    vi.mocked(getActiveCategories).mockResolvedValue([])
    vi.mocked(getBrands).mockResolvedValue({
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
    vi.mocked(getValueTagsWithCoverage).mockResolvedValue([])
  })

  it('renders verified and community rails from the single approved brands result', async () => {
    render(await LandingPage({ params: Promise.resolve({ locale: 'zh-TW' }) }))

    expect(screen.getByRole('heading', { name: '認證品牌' })).toBeInTheDocument()
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '社群推薦' })).toBeInTheDocument()
    expect(screen.getByText('Community')).toBeInTheDocument()
    expect(screen.getByText('Verified Brand')).toBeInTheDocument()
    expect(screen.getByText('Community Brand')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '/brands?verification=verified' })).toHaveAttribute(
      'href',
      '/brands?verification=verified'
    )
    expect(screen.getByRole('link', { name: '/brands?verification=community' })).toHaveAttribute(
      'href',
      '/brands?verification=community'
    )
    expect(getBrands).toHaveBeenCalledTimes(1)
    expect(getBrands).toHaveBeenCalledWith({ status: 'approved', limit: 60 })
  })
})
