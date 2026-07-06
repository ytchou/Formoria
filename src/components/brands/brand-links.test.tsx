// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../messages/zh-TW.json'

const mockTrackExternalLinkClicked = vi.fn()
const mockTrackDbClick = vi.fn()
vi.mock('@/lib/analytics', () => ({
  trackExternalLinkClicked: (...args: unknown[]) =>
    mockTrackExternalLinkClicked(...args),
  trackDbClick: (...args: unknown[]) => mockTrackDbClick(...args),
}))

import { BrandLinks } from './brand-links'

const mockBrand = {
  id: 'b1',
  slug: 'test-brand',
  name: 'Test Brand',
  category: 'accessories',
  description: null,
  status: 'approved' as const,
  isVerified: false,
  isDemo: false,
  heroImageUrl: null,
  city: null,
  foundingYear: null,
  productPhotos: [],
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: 'https://example.com',
  purchasePinkoi: null,
  purchaseShopee: null,
  otherUrls: [],
  retailLocations: [],
  contactEmail: null,
  siteContent: null,
  priceRange: null,
  productTags: [],
  submittedAt: '2024-01-01',
  approvedAt: null,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="zh-TW" messages={zh}>
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('BrandLinks', () => {
  beforeEach(() => {
    mockTrackExternalLinkClicked.mockClear()
    mockTrackDbClick.mockClear()
  })

  it('calls trackExternalLinkClicked when an outbound link is clicked', async () => {
    const user = userEvent.setup()
    renderWithIntl(<BrandLinks brand={mockBrand} />)
    await user.click(screen.getByRole('link', { name: /品牌官網/i }))
    expect(mockTrackExternalLinkClicked).toHaveBeenCalledWith(
      'test-brand',
      expect.any(String),
      expect.any(String),
    )
  })

  it('passes the brand slug as first argument', async () => {
    const user = userEvent.setup()
    renderWithIntl(<BrandLinks brand={mockBrand} />)
    await user.click(screen.getByRole('link', { name: /品牌官網/i }))
    expect(mockTrackExternalLinkClicked.mock.calls[0][0]).toBe('test-brand')
  })
})
