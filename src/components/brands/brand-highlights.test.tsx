// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrandHighlights } from './brand-highlights'
import type { Brand } from '@/lib/types'

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn().mockResolvedValue((key: string) => key),
}))

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
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    otherUrls: [],
    retailLocations: [],
    productPhotos: [],
    contactEmail: null,
    brandHighlights: null,
    siteContent: null,
    tags: [],
    submittedAt: '2026-01-01T00:00:00Z',
    approvedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('BrandHighlights', () => {
  it('renders highlights text when present', async () => {
    const brand = makeBrand({ brandHighlights: 'Made in Tainan since 1992' })
    render(await BrandHighlights({ brand }))
    expect(screen.getByText('Made in Tainan since 1992')).toBeInTheDocument()
  })

  it('renders nothing when brandHighlights is null', async () => {
    const brand = makeBrand({ brandHighlights: null })
    const result = await BrandHighlights({ brand })
    if (result === null) {
      expect(true).toBe(true)
      return
    }
    const { container } = render(result)
    expect(container).toBeEmptyDOMElement()
  })
})
