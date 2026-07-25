// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { BrandHeader } from '../brand-header'
import type { Brand } from '@/lib/types'
import zh from '../../../../messages/zh-TW.json'

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'brand-1',
    name: 'Test Brand',
    slug: 'test-brand',
    description: 'A brand',
    heroImageUrl: null,
    status: 'approved',
    category: 'fashion',
    city: null,
    isVerified: false,
    isDemo: false,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    otherUrls: [],
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
    onboardingDismissedAt: null,
    ...overrides,
  }
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('BrandHeader — verified badge', () => {
  it('places the admin slot at the right edge of the brand name header', () => {
    renderWithIntl(
      <BrandHeader
        brand={makeBrand()}
        adminSlot={<button data-testid="admin-slot">管理選單</button>}
      />,
    )

    const heading = screen.getByRole('heading', { name: 'Test Brand' })
    const adminSlot = screen.getByTestId('admin-slot')

    expect(heading.parentElement).toHaveClass('flex', 'justify-between')
    expect(heading.parentElement).toContainElement(adminSlot)
  })

  it('shows the MIT verified badge for MIT-verified brands', () => {
    renderWithIntl(
      <BrandHeader
        brand={makeBrand({ mitStatus: 'verified', mitVerified: true })}
      />,
    )

    expect(screen.getByTitle('已通過 MIT 微笑標章登錄驗證')).toHaveTextContent(
      'MIT 微笑認證',
    )
  })

  it('shows the declared badge without the MIT verified badge for declared brands', () => {
    renderWithIntl(
      <BrandHeader
        brand={makeBrand({ mitStatus: 'declared', mitVerified: true })}
      />,
    )

    expect(screen.getByText('品牌聲明')).toBeInTheDocument()
    expect(
      screen.getByTitle('由品牌方自行聲明台灣製造；聲明範圍可能涵蓋部分、多數或全部商品'),
    ).toBeInTheDocument()
    expect(
      screen.queryByTitle('已通過 MIT 微笑標章登錄驗證'),
    ).not.toBeInTheDocument()
  })

  it('shows verified badge tooltip when isVerified is true', () => {
    renderWithIntl(<BrandHeader brand={makeBrand({ isVerified: true })} />)
    expect(screen.getByText('品牌經營')).toBeInTheDocument()
    expect(screen.getByTitle('由品牌方經營管理')).toBeInTheDocument()
  })

  it('does not show verified badge when isVerified is false', () => {
    renderWithIntl(<BrandHeader brand={makeBrand({ isVerified: false })} />)
    expect(screen.queryByText('品牌經營')).not.toBeInTheDocument()
    expect(screen.queryByTitle('由品牌方經營管理')).not.toBeInTheDocument()
  })

  it('does not show verified badge based on approvedAt alone', () => {
    renderWithIntl(
      <BrandHeader
        brand={makeBrand({ isVerified: false, approvedAt: '2026-05-01' })}
      />,
    )
    expect(screen.queryByText('品牌經營')).not.toBeInTheDocument()
    expect(screen.queryByTitle('由品牌方經營管理')).not.toBeInTheDocument()
  })

  it('renders the verified badge through the Badge primitive', () => {
    renderWithIntl(<BrandHeader brand={makeBrand({ isVerified: true })} />)
    const badge = screen.getByText('品牌經營')
    expect(badge.closest('[data-slot="badge"]')).not.toBeNull()
  })
})

describe('BrandHeader — fact grid', () => {
  it('stacks each value below its label in a responsive two-column grid', () => {
    renderWithIntl(
      <BrandHeader
        brand={makeBrand({ foundingYear: 2010 })}
        cityLabel="台北市"
      />,
    )

    const locationLabel = screen.getByText('地點').closest('dt')
    const locationValue = screen.getByText('台北市').closest('dd')

    expect(locationLabel?.parentElement?.parentElement).toHaveClass(
      'grid',
      'sm:grid-cols-2',
    )
    expect(locationLabel?.parentElement).toHaveClass('space-y-1')
    expect(locationLabel).toHaveClass(
      'type-field-label',
      'uppercase',
    )
    expect(locationLabel).not.toHaveClass('font-bold')
    expect(locationValue).not.toHaveClass('col-span-2')
  })

  it('lifts verification into a claim strip above the fact list', () => {
    renderWithIntl(
      <BrandHeader
        brand={makeBrand({
          foundingYear: 2010,
          category: 'fashion',
          priceRange: 2,
          productTags: ['手工製作'],
          mitStatus: 'verified',
          isVerified: true,
        })}
        cityLabel="台北市"
      />,
    )

    expect(screen.getByRole('heading', { name: '品牌資訊' })).toHaveClass(
      'type-section-title-large',
    )
    for (const label of ['地點', '創立年份', '類別', '價格區間', '產品類別']) {
      const labelElement = screen.getByText(label)
      expect(labelElement.closest('dt')).toHaveTextContent(label)
    }
    expect(screen.queryByText('認證')).not.toBeInTheDocument()

    const claimStrip = screen.getByText('MIT 微笑認證').parentElement
    expect(claimStrip).toHaveClass('bg-mit-verified-bg')
    expect(claimStrip?.nextElementSibling?.tagName).toBe('DL')
  })

  it('keeps every field visible when data is missing', () => {
    renderWithIntl(
      <BrandHeader
        brand={makeBrand({
          foundingYear: null,
          productTags: [],
          mitStatus: undefined,
          isVerified: false,
        })}
        cityLabel={null}
      />,
    )

    for (const label of ['地點', '創立年份', '類別', '價格區間', '產品類別', '認證']) {
      expect(screen.getByText(label).closest('dt')).toHaveTextContent(label)
    }
    expect(screen.getAllByText('尚無資料')).toHaveLength(5)
  })

  it('uses neutral badges for finite-value fields', () => {
    renderWithIntl(
      <BrandHeader
        brand={makeBrand({ category: 'fashion', priceRange: 2, productTags: ['手工製作'] })}
        cityLabel="台北市"
      />,
    )

    for (const value of ['台北市', 'fashion', '$$', '手工製作']) {
      const badge = screen.getByText(value).closest('[data-slot="badge"]')
      expect(badge).toHaveAttribute('data-variant', 'secondary')
      expect(badge).toHaveClass('text-foreground')
    }
  })
})
