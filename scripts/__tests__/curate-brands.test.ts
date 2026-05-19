import { describe, it, expect } from 'vitest'
import { scoreBrand } from '../curate-brands'

function makeBrand(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-id',
    name: 'Test Brand',
    slug: 'test-brand',
    description: null,
    logoUrl: null,
    heroImageUrl: null,
    status: 'pending' as const,
    category: null,
    foundingYear: null,
    purchaseLinks: [],
    socialLinks: {},
    retailLocations: [],
    productPhotos: [],
    contactEmail: null,
    founder: null,
    productHighlights: [],
    tags: [],
    submittedAt: '2026-01-01T00:00:00Z',
    approvedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('scoreBrand', () => {
  it('returns 0 for empty brand with no URL (before penalty)', () => {
    const brand = makeBrand()
    const result = scoreBrand(brand as any)
    expect(result.score).toBeLessThan(0)
    expect(result.websiteUrl).toBeNull()
  })

  it('scores a fully populated brand at 100', () => {
    const brand = makeBrand({
      description:
        'A detailed description of this brand that is definitely long enough.',
      heroImageUrl: 'https://example.com/hero.jpg',
      productPhotos: [
        'https://example.com/1.jpg',
        'https://example.com/2.jpg',
      ],
      socialLinks: {
        instagram: 'https://instagram.com/test',
        officialWebsite: 'https://example.com',
      },
      purchaseLinks: [
        { platform: 'website', url: 'https://example.com', label: 'Shop' },
      ],
      founder: { name: 'Jane', title: 'CEO', avatarUrl: null, quote: null },
      productHighlights: [
        { name: 'Product A', imageUrl: null, description: 'Great' },
      ],
      category: 'Accessories',
    })
    const result = scoreBrand(brand as any)
    expect(result.score).toBe(100)
    expect(result.websiteUrl).toBe('https://example.com')
  })

  it('applies -50 penalty when no scrapeable URL exists', () => {
    const brand = makeBrand({
      description: 'Has a description that is long enough for points.',
      category: 'Food',
    })
    const result = scoreBrand(brand as any)
    expect(result.score).toBe(15 + 5 - 50)
    expect(result.websiteUrl).toBeNull()
  })

  it('extracts websiteUrl from officialWebsite first', () => {
    const brand = makeBrand({
      socialLinks: { officialWebsite: 'https://brand.com' },
      purchaseLinks: [
        {
          platform: 'pinkoi',
          url: 'https://pinkoi.com/store/x',
          label: 'Pinkoi',
        },
      ],
    })
    const result = scoreBrand(brand as any)
    expect(result.websiteUrl).toBe('https://brand.com')
  })

  it('falls back to first purchaseLink URL when no officialWebsite', () => {
    const brand = makeBrand({
      purchaseLinks: [
        {
          platform: 'pinkoi',
          url: 'https://pinkoi.com/store/x',
          label: 'Pinkoi',
        },
      ],
    })
    const result = scoreBrand(brand as any)
    expect(result.websiteUrl).toBe('https://pinkoi.com/store/x')
  })
})
