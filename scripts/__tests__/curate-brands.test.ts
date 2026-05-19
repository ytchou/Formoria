import { describe, it, expect } from 'vitest'
import { scoreBrand, buildEnrichPatch } from '../curate-brands'

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

describe('buildEnrichPatch', () => {
  const emptyScraped = {
    brandName: null,
    description: null,
    heroImageUrl: null,
    galleryImageUrls: [],
    socialLinks: { instagram: null, threads: null, facebook: null },
    categoryHints: [],
    websiteUrl: 'https://example.com',
    rawJsonLd: null,
  }

  it('fills description when brand has none', () => {
    const brand = makeBrand({ description: null })
    const scraped = { ...emptyScraped, description: 'Scraped description' }
    const patch = buildEnrichPatch(brand as any, scraped)
    expect(patch.description).toBe('Scraped description')
  })

  it('does NOT overwrite existing description', () => {
    const brand = makeBrand({ description: 'Existing description' })
    const scraped = { ...emptyScraped, description: 'Scraped description' }
    const patch = buildEnrichPatch(brand as any, scraped)
    expect(patch.description).toBeUndefined()
  })

  it('merges missing social links without overwriting existing', () => {
    const brand = makeBrand({
      socialLinks: { instagram: 'https://instagram.com/existing' },
    })
    const scraped = {
      ...emptyScraped,
      socialLinks: {
        instagram: 'https://instagram.com/new',
        threads: 'https://threads.net/new',
        facebook: null,
      },
    }
    const patch = buildEnrichPatch(brand as any, scraped)
    expect(patch.socialLinks?.instagram).toBe(
      'https://instagram.com/existing'
    )
    expect(patch.socialLinks?.threads).toBe('https://threads.net/new')
  })

  it('returns empty patch when nothing to fill', () => {
    const brand = makeBrand({
      description: 'Has everything',
      socialLinks: {
        instagram: 'https://instagram.com/x',
        threads: 'https://threads.net/x',
        facebook: 'https://facebook.com/x',
      },
    })
    const patch = buildEnrichPatch(brand as any, emptyScraped)
    expect(Object.keys(patch)).toHaveLength(0)
  })

  it('does not include socialLinks in patch when no new links found', () => {
    const brand = makeBrand({ socialLinks: {} })
    const patch = buildEnrichPatch(brand as any, emptyScraped)
    expect(patch.socialLinks).toBeUndefined()
  })
})
