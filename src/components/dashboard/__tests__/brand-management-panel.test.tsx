// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BrandManagementPanel } from '@/components/dashboard/brand-management-panel'
import { getBrandBySlug } from '@/lib/services/brands'
import { getAnalytics } from '@/lib/services/brand-analytics'
import { computeBrandHealth } from '@/lib/services/brand-health'
import type { Brand } from '@/lib/types/brand'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}))

vi.mock('@/lib/services/brands', () => ({
  getBrandBySlug: vi.fn(),
}))

vi.mock('@/lib/services/brand-completeness', () => ({
  computeBrandCompleteness: vi.fn(() => ({
    total: 9, completed: 5, fraction: 5 / 9,
    items: [], tier1Items: [], tier2Items: [],
  })),
}))

vi.mock('@/lib/services/brand-health', () => ({
  computeBrandHealth: vi.fn(() => ({
    overall: 58, tier: 'growing', dimensions: [], topActions: [],
  })),
}))

vi.mock('@/lib/services/brand-analytics', () => ({
  getAnalytics: vi.fn(async () => ({
    totalViews: 100, totalClicks: 5, viewTrend: 'up', clickTrend: 'flat',
  })),
  getDailySeries: vi.fn(async () => []),
  getLinkClickBreakdown: vi.fn(async () => []),
  getSourceBreakdown: vi.fn(async () => []),
}))

vi.mock('@/components/dashboard/analytics-cards', () => ({
  AnalyticsCards: () => <div data-testid="analytics-cards" />,
}))

vi.mock('@/components/dashboard/analytics-chart', () => ({
  AnalyticsChart: () => <div data-testid="analytics-chart" />,
}))

vi.mock('@/components/dashboard/link-breakdown', () => ({
  LinkBreakdown: () => <div data-testid="link-breakdown" />,
}))

vi.mock('@/components/dashboard/sources-breakdown-card', () => ({
  SourcesBreakdownCard: () => <div data-testid="sources-breakdown-card" />,
}))

vi.mock('@/components/dashboard/mit-status-card', () => ({
  MitStatusCard: () => <div data-testid="mit-status-card" />,
}))

vi.mock('../brand-health-card', () => ({
  BrandHealthCard: () => <div data-testid="brand-health-card" />,
}))

vi.mock('../welcome-banner', () => ({
  WelcomeBanner: () => <div data-testid="welcome-banner" />,
}))

vi.mock('@/lib/services/pending-edits', () => ({
  getLatestEditReview: vi.fn(async () => null),
}))

vi.mock('@/components/brands/edit-review-banner', () => ({
  EditReviewBanner: () => <div data-testid="edit-review-banner" />,
}))

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'brand-1',
    name: 'Test Brand',
    slug: 'test-brand',
    description: 'Test description',
    heroImageUrl: null,
    status: 'approved',
    category: 'food',
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
    customerVoices: [],
    productPhotos: [],
    contactEmail: null,
    brandHighlights: null,
    siteContent: null,
    tags: [],
    submittedAt: '2026-01-01T00:00:00Z',
    approvedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('BrandManagementPanel', () => {
  it('computes brand health from the brand and analytics result', async () => {
    const brand = makeBrand()
    vi.mocked(getBrandBySlug).mockResolvedValue(brand)

    render(await BrandManagementPanel({ slug: 'test-brand', claimedAt: null, userId: 'user-1' }))

    expect(computeBrandHealth).toHaveBeenCalledWith(
      brand,
      await vi.mocked(getAnalytics).mock.results[0].value,
      new Date(brand.createdAt)
    )
  })
})
