// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { BrandHighlights } from './brand-highlights'
import { describe, it, expect } from 'vitest'

function makeBrand(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-id',
    name: 'Test Brand',
    slug: 'test-brand',
    description: 'Test description',
    logoUrl: null,
    heroImageUrl: null,
    status: 'approved' as const,
    category: 'food',
    foundingYear: null,
    purchaseLinks: [],
    socialLinks: {},
    retailLocations: [],
    productPhotos: [],
    contactEmail: null,
    founder: null,
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
    render(<BrandHighlights brand={brand as any} />)
    expect(screen.getByText('Made in Tainan since 1992')).toBeInTheDocument()
  })

  it('renders nothing when brandHighlights is null', () => {
    const brand = makeBrand({ brandHighlights: null })
    const { container } = render(<BrandHighlights brand={brand as any} />)
    expect(container).toBeEmptyDOMElement()
  })
})
