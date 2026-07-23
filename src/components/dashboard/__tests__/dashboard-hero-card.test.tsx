// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Brand } from '@/lib/types'
import { DashboardHeroCard } from '../dashboard-hero-card'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(() => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key),
  getLocale: vi.fn(() => 'zh-TW'),
}))

vi.mock('@/lib/services/brands', () => ({ getBrandBySlug: vi.fn() }))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: ComponentProps<'a'>) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <span aria-label={alt} data-src={src} role="img" />
  ),
}))

const brand: Brand = {
  id: 'brand-1',
  name: '測試品牌',
  romanizedName: 'Test Brand',
  slug: 'test-brand',
  description: '在台灣設計與製造的居家用品。',
  descriptionEn: 'Home goods designed and made in Taiwan.',
  blurb: null,
  blurbEn: null,
  heroImageUrl: null,
  status: 'approved',
  productType: 'home',
  city: '台北市',
  category: 'home',
  isVerified: true,
  mitStatus: 'verified',
  isDemo: false,
  foundingYear: 2020,
  reputationSummary: null,
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: null,
  purchasePinkoi: null,
  purchaseShopee: null,
  otherUrls: [],
  retailLocations: [],
  productPhotos: [],
  imageAlts: [],
  contactEmail: null,
  priceRange: 2,
  productTags: ['家具', '生活選物'],
  productTagsEn: [],
  siteContent: null,
  submittedAt: '2026-01-01',
  approvedAt: '2026-01-02',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
  onboardingDismissedAt: null,
}

describe('DashboardHeroCard', () => {
  it('hero card renders dual-language name and status badge', async () => {
    const { container } = render(
      await DashboardHeroCard({ brand, completenessScore: 80 }),
    )

    expect(screen.getByText('測試品牌')).toBeInTheDocument()
    expect(screen.getByText('Test Brand')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="badge"]')).toBeInTheDocument()
  })

  it('hero card renders metadata row with 4 items', async () => {
    render(await DashboardHeroCard({ brand, completenessScore: 80 }))

    expect(screen.getByText('2020')).toBeInTheDocument()
    expect(screen.getByText('台北市')).toBeInTheDocument()
    expect(screen.getByText('居家生活')).toBeInTheDocument()
    expect(screen.getByText('fieldPriceRangeMidRange')).toBeInTheDocument()
  })
})
