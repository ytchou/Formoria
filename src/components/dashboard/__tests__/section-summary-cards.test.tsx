// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Brand } from '@/lib/types'
import { SectionSummaryCards } from '../section-summary-cards'

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

const brand = {
  id: 'brand-1',
  name: '測試品牌',
  romanizedName: 'Test Brand',
  slug: 'test-brand',
  description: '品牌介紹',
  descriptionEn: null,
  blurb: null,
  blurbEn: null,
  heroImageUrl: null,
  status: 'approved',
  productType: 'home',
  city: '台北市',
  category: 'home',
  isVerified: false,
  mitStatus: 'declared',
  mitDeclaredScope: 'most',
  isDemo: false,
  foundingYear: 2020,
  reputationSummary: {
    text: '曾獲媒體報導',
    sources: [{ url: 'https://example.com/story' }],
  },
  socialInstagram: 'https://instagram.com/test',
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: 'https://example.com',
  purchasePinkoi: null,
  purchaseShopee: null,
  otherUrls: [],
  retailLocations: [],
  productPhotos: ['https://example.com/product.jpg'],
  imageAlts: [],
  contactEmail: null,
  priceRange: 2,
  productTags: [],
  productTagsEn: [],
  siteContent: null,
  submittedAt: '2026-01-01',
  approvedAt: '2026-01-02',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
  onboardingDismissedAt: null,
} satisfies Brand

describe('SectionSummaryCards', () => {
  it('section summary cards renders 4 cards with edit links', async () => {
    const { container } = render(
      await SectionSummaryCards({ brand, slug: 'test-brand' }),
    )

    expect(container.querySelectorAll('[data-slot="surface-card"]')).toHaveLength(4)
    expect(screen.getByText('sectionMediaTitle')).toBeInTheDocument()
    expect(screen.getByText('sectionLinksTitle')).toBeInTheDocument()
    expect(screen.getByText('sectionVerificationTitle')).toBeInTheDocument()
    expect(screen.getByText('wizardStepReputation')).toBeInTheDocument()

    expect(screen.getAllByRole('link')).toHaveLength(4)
    expect(screen.getByRole('link', { name: 'edit: sectionMediaTitle' })).toHaveAttribute(
      'href',
      '/dashboard/brands/test-brand/edit?step=1',
    )
    expect(screen.getByRole('link', { name: 'edit: sectionLinksTitle' })).toHaveAttribute(
      'href',
      '/dashboard/brands/test-brand/edit?step=2',
    )
    expect(screen.getByRole('link', { name: 'edit: sectionVerificationTitle' })).toHaveAttribute(
      'href',
      '/dashboard/brands/test-brand/verification',
    )
    expect(screen.getByRole('link', { name: 'edit: wizardStepReputation' })).toHaveAttribute(
      'href',
      '/dashboard/brands/test-brand/edit?step=4',
    )
  })
})
