// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockTrackExternalLinkClicked = vi.fn()
vi.mock('@/lib/analytics', () => ({
  trackExternalLinkClicked: (...args: unknown[]) => mockTrackExternalLinkClicked(...args),
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
  logoUrl: null,
  heroImageUrl: null,
  foundingYear: null,
  tags: [],
  productPhotos: [],
  socialLinks: {
    officialWebsite: 'https://example.com',
  },
  purchaseLinks: [],
  retailLocations: [],
  contactEmail: null,
  founder: null,
  brandHighlights: null,
  submittedAt: '2024-01-01',
  approvedAt: null,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
}

describe('BrandLinks', () => {
  beforeEach(() => {
    mockTrackExternalLinkClicked.mockClear()
  })

  it('calls trackExternalLinkClicked when an outbound link is clicked', async () => {
    const user = userEvent.setup()
    render(<BrandLinks brand={mockBrand} />)
    await user.click(screen.getByRole('link', { name: /Website/i }))
    expect(mockTrackExternalLinkClicked).toHaveBeenCalledWith(
      'test-brand',
      expect.any(String),
      expect.any(String),
    )
  })

  it('passes the brand slug as first argument', async () => {
    const user = userEvent.setup()
    render(<BrandLinks brand={mockBrand} />)
    await user.click(screen.getByRole('link', { name: /Website/i }))
    expect(mockTrackExternalLinkClicked.mock.calls[0][0]).toBe('test-brand')
  })
})
