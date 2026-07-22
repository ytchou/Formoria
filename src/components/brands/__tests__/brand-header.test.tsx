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

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('BrandHeader — verified badge', () => {
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

  it('does not render retail locations in the metadata row', () => {
    renderWithIntl(
      <BrandHeader
        brand={makeBrand({
          retailLocations: [
            {
              kind: 'location',
              name: '大零售地點',
              relationshipType: 'stockist',
              confirmationStatus: 'unconfirmed',
              address: '新北市林口區麗園一街11巷',
              latitude: 25.073,
              longitude: 121.389,
            },
          ],
        })}
      />,
    )

    expect(screen.queryByText('大零售地點')).not.toBeInTheDocument()
  })

  it('renders the verified badge through the Badge primitive', () => {
    renderWithIntl(<BrandHeader brand={makeBrand({ isVerified: true })} />)
    const badge = screen.getByText('品牌經營')
    expect(badge.closest('[data-slot="badge"]')).not.toBeNull()
  })
})
