// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrandHeader } from '../brand-header'
import type { Brand } from '@/lib/types'

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
    brandHighlights: null,
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

describe('BrandHeader — verified badge', () => {
  it('shows verified badge tooltip when isVerified is true', () => {
    render(<BrandHeader brand={makeBrand({ isVerified: true })} />)
    expect(
      screen.getByTitle('This brand has been verified by its owner')
    ).toBeInTheDocument()
  })

  it('does not show verified badge when isVerified is false', () => {
    render(<BrandHeader brand={makeBrand({ isVerified: false })} />)
    expect(
      screen.queryByTitle('This brand has been verified by its owner')
    ).not.toBeInTheDocument()
  })

  it('does not show verified badge based on approvedAt alone', () => {
    render(<BrandHeader brand={makeBrand({ isVerified: false, approvedAt: '2026-05-01' })} />)
    expect(
      screen.queryByTitle('This brand has been verified by its owner')
    ).not.toBeInTheDocument()
  })
})
