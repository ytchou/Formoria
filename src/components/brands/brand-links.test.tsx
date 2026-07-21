// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NextIntlClientProvider } from 'next-intl'
import zh from '../../../messages/zh-TW.json'

const mockTrackExternalLinkClicked = vi.fn()
vi.mock('@/lib/analytics', () => ({
  trackExternalLinkClicked: (...args: unknown[]) =>
    mockTrackExternalLinkClicked(...args),
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
  productTagsEn: [],
  descriptionEn: null,
  blurb: null,
  blurbEn: null,
  imageAlts: [],
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
  })

  it('calls trackExternalLinkClicked when an outbound link is clicked', async () => {
    const user = userEvent.setup()
    renderWithIntl(<BrandLinks brand={mockBrand} />)
    await user.click(screen.getByRole('link', { name: /品牌官網/i }))
    expect(mockTrackExternalLinkClicked).toHaveBeenCalledWith(
      'test-brand',
      expect.any(String),
      expect.any(String),
      'b1',
    )
  })

  it('passes the brand slug as first argument', async () => {
    const user = userEvent.setup()
    renderWithIntl(<BrandLinks brand={mockBrand} />)
    await user.click(screen.getByRole('link', { name: /品牌官網/i }))
    expect(mockTrackExternalLinkClicked.mock.calls[0][0]).toBe('test-brand')
  })

  it('renders repeated other link labels without React key warnings', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)
    const brandWithRepeatedOtherLinks = {
      ...mockBrand,
      otherUrls: [
        { label: 'Portfolio', url: 'https://example.com/one' },
        { label: 'Portfolio', url: 'https://example.com/two' },
      ],
    }

    try {
      renderWithIntl(<BrandLinks brand={brandWithRepeatedOtherLinks} />)

      const keyWarningWasLogged = consoleError.mock.calls.some(([message]) =>
        String(message).includes('unique "key" prop'),
      )
      expect(keyWarningWasLogged).toBe(false)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('hides other links when entries have no usable label or URL', () => {
    renderWithIntl(
      <BrandLinks
        brand={{
          ...mockBrand,
          otherUrls: [
            { label: '', url: 'https://example.com/blank-label' },
            { label: 'Portfolio', url: '' },
          ],
        }}
      />,
    )

    expect(screen.queryByText('其他連結')).not.toBeInTheDocument()
  })

  it('hides other links when runtime data is missing labels', () => {
    renderWithIntl(
      <BrandLinks
        brand={{
          ...mockBrand,
          otherUrls: [
            { url: 'https://example.com/missing-label' },
          ] as typeof mockBrand.otherUrls,
        }}
      />,
    )

    expect(screen.queryByText('其他連結')).not.toBeInTheDocument()
  })

  it('does not render unsafe website links', () => {
    renderWithIntl(
      <BrandLinks
        brand={{
          ...mockBrand,
          purchaseWebsite: 'javascript:alert(1)',
        }}
      />,
    )

    expect(screen.queryByRole('link', { name: /品牌官網/i })).not.toBeInTheDocument()
  })

  it('uses standardized pill buttons with destination icon accents', () => {
    renderWithIntl(
      <BrandLinks
        brand={{
          ...mockBrand,
          socialInstagram: '@test-brand',
          socialFacebook: 'https://facebook.com/test-brand',
          purchasePinkoi: 'https://pinkoi.com/store/test-brand',
          purchaseShopee: 'https://shopee.tw/test-brand',
        }}
      />,
    )

    const websiteLink = screen.getByRole('link', { name: /品牌官網/i })
    expect(websiteLink).toHaveClass('rounded-full')
    expect(websiteLink).toHaveClass('border-border')
    expect(websiteLink).toHaveClass('justify-center')
    expect(websiteLink.firstElementChild).toHaveClass('text-primary')

    expect(screen.getByRole('link', { name: /Instagram/i }).firstElementChild?.className).toMatch(
      /\btext-\[#/,
    )
    expect(screen.getByRole('link', { name: /Facebook/i }).firstElementChild?.className).toMatch(
      /\btext-\[#/,
    )
    expect(screen.getByRole('link', { name: /Pinkoi/i }).firstElementChild?.className).toMatch(
      /\btext-\[#/,
    )
    expect(screen.getByRole('link', { name: /蝦皮購物/i }).firstElementChild?.className).toMatch(
      /\btext-\[#/,
    )
  })
})
