// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrandCard } from '../brand-card'
import type { Brand } from '@/lib/types'

vi.mock('@/lib/analytics', () => ({
  trackBrandCardClicked: vi.fn(),
}))

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'brand-1',
    name: 'Test Brand',
    slug: 'test-brand',
    description: 'A brand',
    logoUrl: null,
    heroImageUrl: null,
    status: 'approved',
    category: 'fashion',
    isVerified: false,
    purchaseLinks: [],
    socialLinks: {},
    retailLocations: [],
    productPhotos: [],
    productHighlights: [],
    tags: [],
    founder: null,
    foundingYear: null,
    contactEmail: null,
    submittedAt: '2026-01-01T00:00:00Z',
    approvedAt: '2026-01-02T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('BrandCard — verified badge', () => {
  it('renders a verified badge when isVerified is true', () => {
    render(<BrandCard brand={makeBrand({ isVerified: true })} />)
    expect(screen.getByLabelText('Verified brand')).toBeInTheDocument()
  })

  it('does not render a verified badge when isVerified is false', () => {
    render(<BrandCard brand={makeBrand({ isVerified: false })} />)
    expect(screen.queryByLabelText('Verified brand')).not.toBeInTheDocument()
  })
})
