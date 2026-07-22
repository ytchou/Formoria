// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { BrandLocations } from '../brand-locations'
import type { Brand } from '@/lib/types'
import zh from '../../../../messages/zh-TW.json'

const brandWithLocation: Brand = {
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
  retailLocations: [
    {
      kind: 'location',
      name: '大零售地點',
      relationshipType: 'stockist',
      confirmationStatus: 'unconfirmed',
      type: 'independent',
      address: '新北市林口區麗園一街11巷',
      latitude: 25.073,
      longitude: 121.389,
      verificationStatus: 'verified',
    },
    {
      kind: 'location',
      name: '新光三越櫃位',
      relationshipType: 'department_counter',
      confirmationStatus: 'unconfirmed',
      type: 'chain',
      venueName: '新光三越 台北信義新天地 A11',
      floorOrCounter: '3F',
      address: '台北市信義區松壽路11號',
      verificationStatus: 'manual',
    },
  ],
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
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('BrandLocations', () => {
  it('separates map-safe locations from chain retailers', () => {
    renderWithIntl(<BrandLocations brand={brandWithLocation} />)

    expect(screen.getByText('大零售地點')).toBeInTheDocument()
    expect(screen.getByText('地圖上的獨立地點')).toBeInTheDocument()
    expect(screen.getByText('販售地點')).toBeInTheDocument()
    expect(screen.getByText('新光三越櫃位')).toBeInTheDocument()
    expect(screen.getByText('百貨專櫃')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '連鎖通路' }),
    ).toBeInTheDocument()
    expect(screen.getByText('手動地址')).toBeInTheDocument()
    expect(
      screen.getAllByRole('link', { name: /在 Google Maps 開啟/ }),
    ).toHaveLength(2)
    expect(document.querySelector('iframe')).not.toBeInTheDocument()
  })
})
