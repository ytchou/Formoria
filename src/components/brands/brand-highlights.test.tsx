// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { BrandHighlights } from './brand-highlights'
import { describe, it, expect } from 'vitest'
import type { Brand } from '@/lib/types'

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'test-id',
    name: 'Test Brand',
    slug: 'test-brand',
    description: 'Test description',
    logoUrl: null,
    heroImageUrl: null,
    status: 'approved',
    category: 'food',
    isVerified: false,
    isDemo: false,
    foundingYear: null,
    purchaseLinks: [],
    socialLinks: {},
    retailLocations: [],
    productPhotos: [],
    contactEmail: null,
    brandHighlights: null,
    tags: [],
    submittedAt: '2026-01-01T00:00:00Z',
    approvedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('BrandHighlights', () => {
  it('renders highlights text when present', () => {
    const brand = makeBrand({ brandHighlights: 'Made in Tainan since 1992' })
    render(<BrandHighlights brand={brand} />)
    expect(screen.getByText('Made in Tainan since 1992')).toBeInTheDocument()
  })

  it('renders nothing when brandHighlights is null', () => {
    const brand = makeBrand({ brandHighlights: null })
    const { container } = render(<BrandHighlights brand={brand} />)
    expect(container).toBeEmptyDOMElement()
  })
})
