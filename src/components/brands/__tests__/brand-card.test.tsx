// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { BrandCard } from '../brand-card'
import type { Brand } from '@/lib/types'
import zh from '../../../../messages/zh-TW.json'

const analyticsMocks = vi.hoisted(() => ({
  trackBrandCardClicked: vi.fn(),
  trackRecommendationBrandClicked: vi.fn(),
}))

vi.mock('@/lib/analytics', () => ({
  trackBrandCardClicked: analyticsMocks.trackBrandCardClicked,
  trackRecommendationBrandClicked: analyticsMocks.trackRecommendationBrandClicked,
}))

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('../save-brand-button', () => ({
  SaveBrandButton: ({
    brandId,
    slug,
    variant,
  }: {
    brandId: string
    slug: string
    variant: 'overlay' | 'inline'
  }) => (
    <button
      type="button"
      aria-label="收藏品牌"
      data-brand-id={brandId}
      data-slug={slug}
      data-variant={variant}
    />
  ),
}))

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'brand-1',
    name: '測試品牌',
    slug: 'test-brand',
    description: '品牌描述',
    heroImageUrl: null,
    status: 'approved',
    category: 'fashion',
    city: null,
    isVerified: false,
    mitStatus: 'unverified',
    mitVerifiedAt: null,
    mitEvidence: null,
    mitVerified: false,
    isDemo: false,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    otherUrls: [],
    retailLocations: [],
    productPhotos: [],
    siteContent: null,
    priceRange: null,
    productTags: [],
    productTagsEn: [],
    descriptionEn: null,
    blurb: null,
    blurbEn: null,
    imageAlts: [],
    foundingYear: null,
    contactEmail: null,
    submittedAt: '2026-01-01T00:00:00Z',
    approvedAt: '2026-01-02T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('BrandCard badges', () => {
  it('renders the MIT verified badge for MIT-verified brands', () => {
    renderWithProvider(
      <BrandCard
        brand={makeBrand({ mitStatus: 'verified', mitVerified: true })}
      />,
    )

    expect(screen.getByTitle('MIT 微笑認證')).toBeInTheDocument()
    expect(screen.getByTitle('MIT 微笑認證')).toHaveTextContent('MIT')
  })

  it('renders the declared badge without the MIT verified badge for declared brands', () => {
    renderWithProvider(
      <BrandCard
        brand={makeBrand({ mitStatus: 'declared', mitVerified: true })}
      />,
    )

    expect(screen.getByText('品牌聲明')).toBeInTheDocument()
    expect(
      screen.getByTitle('由品牌方自行聲明台灣製造；聲明範圍可能涵蓋部分、多數或全部商品'),
    ).toBeInTheDocument()
    expect(screen.queryByTitle('MIT 微笑認證')).not.toBeInTheDocument()
  })

  it('renders the owner badge for verified brands', () => {
    renderWithProvider(<BrandCard brand={makeBrand({ isVerified: true })} />)

    expect(screen.getByTitle('由品牌方經營管理')).toBeInTheDocument()
    expect(screen.getByTitle('由品牌方經營管理')).toHaveTextContent('已認領')
  })

  it('renders community text without the owner badge for community brands', () => {
    renderWithProvider(
      <BrandCard brand={makeBrand({ category: '社群', isVerified: false })} />,
    )

    expect(screen.queryByTitle('由品牌方經營管理')).toBeNull()
    expect(screen.getByText('社群')).toBeInTheDocument()
  })

  it('renders no badge when isVerified is false and mitVerified is false', () => {
    renderWithProvider(
      <BrandCard
        brand={makeBrand({ isVerified: false, mitVerified: false })}
      />,
    )

    expect(screen.queryByTitle('由品牌方經營管理')).toBeNull()
    expect(screen.queryByTitle('MIT 微笑認證')).toBeNull()
  })

  it('renders a save button overlay on the card image', () => {
    renderWithProvider(<BrandCard brand={makeBrand()} />)

    expect(screen.getByRole('button', { name: /收藏/ })).toBeInTheDocument()
  })

  it('reuses the card shell for a compact recommendation', () => {
    renderWithProvider(<BrandCard brand={makeBrand()} variant="recommendation" />)

    expect(screen.getByRole('link', { name: '查看品牌' })).toHaveAttribute(
      'href',
      '/brands/test-brand',
    )
    expect(screen.queryByRole('button', { name: /收藏/ })).toBeNull()
    expect(screen.queryByText('品牌描述')).toBeNull()
  })

  it('fires trackRecommendationBrandClicked instead of trackBrandCardClicked for recommendation variant', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    renderWithProvider(
      <BrandCard
        brand={makeBrand()}
        variant="recommendation"
        sourceBrandSlug="source-brand"
        position={2}
      />,
    )

    await user.click(screen.getByRole('link', { name: '查看品牌' }))

    expect(analyticsMocks.trackRecommendationBrandClicked).toHaveBeenCalledWith(
      'brand-1',
      'test-brand',
      'source-brand',
      2,
    )
    expect(analyticsMocks.trackBrandCardClicked).not.toHaveBeenCalled()
  })
})
