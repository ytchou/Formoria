// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockTrackBrandCardClicked = vi.fn()
vi.mock('@/lib/analytics', () => ({
  trackBrandCardClicked: (...args: unknown[]) => mockTrackBrandCardClicked(...args),
}))

import { BrandCard } from './brand-card'

const mockBrand = {
  id: 'b1',
  slug: 'test-brand',
  name: 'Test Brand',
  category: 'accessories',
  description: 'A test brand',
  status: 'approved' as const,
  isVerified: false,
  logoUrl: null,
  heroImageUrl: null,
  foundingYear: 2020,
  tags: [],
  productPhotos: [],
  socialLinks: {},
  purchaseLinks: [],
  retailLocations: [],
  contactEmail: null,
  founder: null,
  productHighlights: [],
  submittedAt: '2024-01-01',
  approvedAt: null,
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
}

describe('BrandCard', () => {
  beforeEach(() => {
    mockTrackBrandCardClicked.mockClear()
  })

  it('calls trackBrandCardClicked with slug, category, and position on click', async () => {
    const user = userEvent.setup()
    render(<BrandCard brand={mockBrand} position={2} />)
    await user.click(screen.getByRole('link'))
    expect(mockTrackBrandCardClicked).toHaveBeenCalledWith('test-brand', 'accessories', 2)
  })

  it('defaults position to 0 when not provided', async () => {
    const user = userEvent.setup()
    render(<BrandCard brand={mockBrand} />)
    await user.click(screen.getByRole('link'))
    expect(mockTrackBrandCardClicked).toHaveBeenCalledWith('test-brand', 'accessories', 0)
  })
})
