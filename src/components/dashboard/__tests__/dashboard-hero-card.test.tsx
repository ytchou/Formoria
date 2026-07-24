// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProfileCompleteness } from '@/lib/services/profile-completeness'
import type { Brand } from '@/lib/types'
import { DashboardHeroCard } from '../dashboard-hero-card'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(
    (namespace: string) => (key: string, params?: Record<string, unknown>) => {
      if (namespace === 'dashboard.overview') {
        if (key === 'completedCount') {
          return `已完成 ${params?.completed}/${params?.total} 個項目`
        }
        if (key === 'warningIncomplete') {
          return `還有 ${params?.count} 個品牌檔案項目需要完成。`
        }
        if (key === 'viewAllTodos') return '查看待完成項目'
      }

      return params ? `${key}:${JSON.stringify(params)}` : key
    },
  ),
  getLocale: vi.fn(() => 'zh-TW'),
}))

vi.mock('@/lib/services/brands', () => ({ getBrandBySlug: vi.fn() }))

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: ComponentProps<'a'>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <span aria-label={alt} data-src={src} role="img" />
  ),
}))

vi.mock('../completeness-ring', () => ({
  CompletenessRing: ({ score }: { score: number }) => (
    <span data-score={score} data-testid="completeness-ring" />
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

const incomplete: ProfileCompleteness = {
  score: 80,
  completed: 9,
  total: 11,
  components: [],
  recommendations: [
    {
      key: 'heroImage',
      complete: false,
      required: true,
      weight: 5,
      step: 1,
    },
    {
      key: 'productPhotos',
      complete: false,
      required: true,
      weight: 5,
      step: 1,
    },
  ],
}

describe('DashboardHeroCard', () => {
  it('hero card renders dual-language name and status badge', async () => {
    const { container } = render(
      await DashboardHeroCard({ brand, completeness: incomplete }),
    )

    expect(screen.getByText('測試品牌')).toBeInTheDocument()
    expect(screen.getByText('Test Brand')).toBeInTheDocument()
    const statusBadges = container.querySelectorAll('[data-slot="badge"]')
    expect(statusBadges.item(0)).toHaveTextContent('published')
    expect(statusBadges.item(0)).toHaveClass('bg-verified-green-bg')
    expect(statusBadges.item(1)).toHaveTextContent('status.verified')
  })

  it('hero card renders a secondary badge when the brand is hidden', async () => {
    const { container } = render(
      await DashboardHeroCard({
        brand: { ...brand, status: 'hidden', mitStatus: 'unverified' },
        completeness: incomplete,
      }),
    )

    const statusBadges = container.querySelectorAll('[data-slot="badge"]')
    expect(statusBadges.item(0)).toHaveTextContent('hidden')
    expect(statusBadges.item(0)).toHaveClass('bg-secondary')
    expect(statusBadges.item(1)).toHaveTextContent('status.unverified')
  })

  it('hero card renders metadata row with 4 items', async () => {
    render(await DashboardHeroCard({ brand, completeness: incomplete }))

    expect(screen.getByText('2020')).toBeInTheDocument()
    expect(screen.getByText('台北市')).toBeInTheDocument()
    expect(screen.getByText('居家生活')).toBeInTheDocument()
    expect(screen.getByText('fieldPriceRangeMidRange')).toBeInTheDocument()
  })

  it('renders_3_column_layout_with_image_metadata_and_completeness', async () => {
    render(await DashboardHeroCard({ brand, completeness: incomplete }))

    expect(screen.getByTestId('hero-image')).toBeInTheDocument()
    expect(screen.getByTestId('hero-metadata')).toBeInTheDocument()
    expect(screen.getByTestId('hero-completeness')).toBeInTheDocument()
  })

  it('renders_completeness_ring_with_score', async () => {
    render(await DashboardHeroCard({ brand, completeness: incomplete }))

    expect(screen.getByTestId('completeness-ring')).toHaveAttribute(
      'data-score',
      '80',
    )
  })

  it('renders_completion_stats_and_cta', async () => {
    render(await DashboardHeroCard({ brand, completeness: incomplete }))

    expect(screen.getByText('已完成 9/11 個項目')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '查看待完成項目' }),
    ).toHaveAttribute(
      'href',
      '/dashboard/brands/test-brand#profile-completeness',
    )
  })

  it('renders_warning_when_incomplete', async () => {
    render(await DashboardHeroCard({ brand, completeness: incomplete }))

    expect(
      screen.getByText('還有 2 個品牌檔案項目需要完成。'),
    ).toBeInTheDocument()
  })

  it('hides_warning_when_complete', async () => {
    render(
      await DashboardHeroCard({
        brand,
        completeness: {
          ...incomplete,
          score: 100,
          completed: 11,
          recommendations: [],
        },
      }),
    )

    expect(screen.queryByText(/品牌檔案項目需要完成/)).not.toBeInTheDocument()
  })
})
