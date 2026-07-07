// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { BrandCard } from '../brand-card'
import type { Brand } from '@/lib/types'
import zh from '../../../../messages/zh-TW.json'

vi.mock('@/lib/analytics', () => ({
  trackBrandCardClicked: vi.fn(),
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
    variant,
  }: {
    brandId: string
    variant: 'overlay' | 'inline'
  }) => (
    <button
      type="button"
      aria-label="收藏品牌"
      data-brand-id={brandId}
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

    expect(screen.getByTitle('MIT 已驗證')).toBeInTheDocument()
    expect(screen.getByTitle('MIT 已驗證')).toHaveTextContent('MIT')
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
    expect(screen.queryByTitle('MIT 已驗證')).toBeNull()
  })

  it('renders a save button overlay on the card image', () => {
    renderWithProvider(<BrandCard brand={makeBrand()} />)

    expect(screen.getByRole('button', { name: /收藏/ })).toBeInTheDocument()
  })
})
