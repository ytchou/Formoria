// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import { BrandLocations } from '../brand-locations'
import type { Brand, RetailLocation } from '@/lib/types'
import zh from '../../../../messages/zh-TW.json'

vi.mock('../brand-locations-map', () => ({
  BrandLocationsMap: ({ locations }: { locations: RetailLocation[] }) => (
    <div
      data-testid='locations-map'
      data-locations={locations.map((location) => location.name).join('|')}
    />
  ),
}))

const messages = {
  ...zh,
  brandDetail: {
    ...zh.brandDetail,
    sections: {
      ...zh.brandDetail.sections,
      locationsAndRetailChannels: '販售地點與零售通路',
    },
    locations: {
      ...zh.brandDetail.locations,
      locationHeading: '販售地點',
      confirmedHeading: '已確認地點',
      stockDisclaimer: '販售品項與庫存可能變動，前往前請先向店家確認。',
      unconfirmedHeading: '待確認地點',
      unconfirmedDisclaimer: '以下是盡力整理的公開資訊，尚未經品牌確認。',
      unconfirmedStatus: '未經品牌確認',
      chainBadge: '連鎖通路',
      someStoresBadge: '部分門市',
      retailerWebsite: '查看通路網站',
      filters: {
        all: '全部',
        brandStores: '品牌門市',
        otherSales: '其他販售地點',
      },
      views: {
        map: '地圖模式',
        viewAll: '查看全部',
      },
      mapLoading: '地圖載入中',
      zoomIn: '放大地圖',
      zoomOut: '縮小地圖',
    },
  },
}

const baseBrand: Brand = {
  id: 'brand-location-1',
  name: 'Warmwood Living',
  slug: 'warmwood-living',
  description: null,
  heroImageUrl: null,
  status: 'approved',
  category: 'home',
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
  onboardingDismissedAt: null,
}

const confirmedLocations: RetailLocation[] = [
  {
    kind: 'location',
    name: '品牌門市一號',
    relationshipType: 'brand_store',
    confirmationStatus: 'owner_confirmed',
    address: '台北市品牌路 1 號',
    venueName: '品牌生活館',
    floorOrCounter: '1F',
    availabilityNote: '現場展示全系列',
    latitude: 25.03,
    longitude: 121.56,
  },
  {
    kind: 'location',
    name: '選物店一號',
    relationshipType: 'stockist',
    confirmationStatus: 'owner_confirmed',
    address: '台中市選物路 2 號',
    latitude: 24.14,
    longitude: 120.68,
  },
  {
    kind: 'location',
    name: '百貨專櫃一號',
    relationshipType: 'department_counter',
    confirmationStatus: 'owner_confirmed',
    address: '高雄市百貨路 3 號',
  },
  {
    kind: 'location',
    name: '選物店二號',
    relationshipType: 'stockist',
    confirmationStatus: 'owner_confirmed',
    address: '台南市選物路 4 號',
    latitude: 22.99,
    longitude: 120.2,
  },
]

const publicAndChainLocations: RetailLocation[] = [
  {
    kind: 'location',
    name: '公開資訊地點',
    relationshipType: 'department_counter',
    confirmationStatus: 'unconfirmed',
    verificationStatus: 'needs_review',
    address: '不應公開的地址',
    venueName: '不應公開的商場',
    floorOrCounter: '不應公開的樓層',
    availabilityNote: '不應公開的庫存資訊',
    latitude: 25.04,
    longitude: 121.57,
  },
  {
    kind: 'retail_chain',
    name: '安全連鎖通路',
    retailerUrl: 'https://retailer.example/shops',
    availabilityNote: '不應顯示的連鎖庫存資訊',
  },
  {
    kind: 'retail_chain',
    name: '不安全連鎖通路',
    retailerUrl: 'javascript:alert(1)',
  },
]

function getConfirmedLocation(name: string): RetailLocation {
  const location = confirmedLocations.find((item) => item.name === name)
  if (!location) throw new Error(`Missing confirmed location: ${name}`)
  return location
}

function renderLocations(locations: RetailLocation[]) {
  return render(
    <NextIntlClientProvider locale='zh-TW' messages={messages}>
      <BrandLocations brand={{ ...baseBrand, retailLocations: locations }} />
    </NextIntlClientProvider>,
  )
}

describe('BrandLocations', () => {
  it('renders addressed unconfirmed locations publicly with honest trust labels', () => {
    renderLocations([...confirmedLocations, ...publicAndChainLocations])

    expect(
      screen.getByRole('heading', { name: '販售地點與零售通路' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '販售地點 · 5' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', {
        name: `${messages.brandDetail.locations.chainHeading} · 2`,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        '各分店販售情況不同；通路連結僅供查詢通路資訊，不代表即時庫存。',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(zh.brandDetail.locations.verifiedDisclaimer),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '查看全部' }))
    const unconfirmedCard = screen
      .getByText('公開資訊地點')
      .closest('[data-slot="surface-card"]')
    expect(unconfirmedCard).toBeInstanceOf(HTMLElement)
    if (!(unconfirmedCard instanceof HTMLElement)) {
      throw new Error('Missing unconfirmed location card')
    }
    expect(
      within(unconfirmedCard).getByText('未經品牌確認'),
    ).toBeInTheDocument()
    expect(within(unconfirmedCard).getByRole('link')).toBeInTheDocument()
    expect(screen.getByText('不應公開的地址')).toBeInTheDocument()
    expect(screen.getByText('不應公開的商場 - 不應公開的樓層')).toBeInTheDocument()
    expect(screen.getByText('不應公開的庫存資訊')).toBeInTheDocument()
    expect(
      screen.queryByText('不應顯示的連鎖庫存資訊'),
    ).not.toBeInTheDocument()

    expect(screen.getByText('品牌生活館 - 1F')).toBeInTheDocument()
    expect(screen.getByText('台北市品牌路 1 號')).toBeInTheDocument()
    expect(screen.getByText('現場展示全系列')).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: '在 Google Maps 開啟' }),
    ).toHaveLength(5)

    expect(screen.getAllByText('部分門市')).toHaveLength(2)
    const retailerLink = screen.getByRole('link', { name: '查看通路網站' })
    expect(retailerLink).toHaveAttribute(
      'href',
      'https://retailer.example/shops',
    )
    expect(screen.getAllByRole('link', { name: '查看通路網站' })).toHaveLength(
      1,
    )
  })

  it('filters with counts, refits map props, and switches preview to full list', () => {
    renderLocations(confirmedLocations)

    expect(screen.getByRole('button', { name: '全部 4' })).toHaveClass(
      'min-h-12',
    )
    expect(screen.getByRole('button', { name: '品牌門市 1' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '其他販售地點 3' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('locations-map')).toHaveAttribute(
      'data-locations',
      '品牌門市一號|選物店一號|選物店二號',
    )
    expect(screen.getByText('百貨專櫃一號')).toBeInTheDocument()
    expect(screen.queryByText('選物店二號')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '查看全部' }))
    expect(screen.getByText('選物店二號')).toBeInTheDocument()
    expect(screen.queryByTestId('locations-map')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '地圖模式' }))
    fireEvent.click(screen.getByRole('button', { name: '其他販售地點 3' }))
    expect(screen.getByTestId('locations-map')).toHaveAttribute(
      'data-locations',
      '選物店一號|選物店二號',
    )
    expect(screen.queryByText('品牌門市一號')).not.toBeInTheDocument()
  })

  it('publishes an evidence-verified address without owner confirmation', () => {
    renderLocations([
      {
        kind: 'location',
        name: '官方驗證門市',
        relationshipType: 'brand_store',
        confirmationStatus: 'unconfirmed',
        verificationStatus: 'verified',
        address: '台北市官方路 9 號',
        latitude: 25.03,
        longitude: 121.56,
      },
    ])

    expect(screen.getByText('台北市官方路 9 號')).toBeInTheDocument()
    expect(screen.getByText('未經品牌確認')).toBeInTheDocument()
    expect(screen.getByTestId('locations-map')).toHaveAttribute('data-locations', '官方驗證門市')
  })

  it('publishes an evidence-verified address without requiring coordinates', () => {
    renderLocations([
      {
        kind: 'location',
        name: '官方地址地點',
        relationshipType: 'stockist',
        confirmationStatus: 'unconfirmed',
        verificationStatus: 'verified',
        address: '台北市官方地址路 10 號',
      },
    ])

    expect(screen.getByText('台北市官方地址路 10 號')).toBeInTheDocument()
    expect(screen.queryByTestId('locations-map')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '地圖模式' })).not.toBeInTheDocument()
  })

  it('falls back to the full list when a filter has no mappable rows', () => {
    renderLocations([
      getConfirmedLocation('品牌門市一號'),
      getConfirmedLocation('百貨專櫃一號'),
    ])

    expect(screen.getByTestId('locations-map')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '其他販售地點 1' }))

    expect(screen.queryByTestId('locations-map')).not.toBeInTheDocument()
    expect(screen.getByText('百貨專櫃一號')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: '地圖模式' }),
    ).not.toBeInTheDocument()
  })

  it('hides category filters unless both categories exist', () => {
    renderLocations([getConfirmedLocation('品牌門市一號')])

    expect(
      screen.queryByRole('button', { name: /品牌門市/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /其他販售地點/ }),
    ).not.toBeInTheDocument()
  })
})
