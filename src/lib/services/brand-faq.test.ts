import { describe, expect, it } from 'vitest'
import type { Brand } from '@/lib/types'
import { buildBrandFaq } from '@/lib/services/brand-faq'

function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'brand-1',
    name: 'Test Brand',
    slug: 'test-brand',
    description: null,
    heroImageUrl: null,
    status: 'approved',
    category: null,
    city: null,
    isVerified: false,
    mitStatus: 'unverified',
    isDemo: false,
    foundingYear: null,
    reputationSummary: null,
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
    priceRange: null,
    productTags: [],
    productTagsEn: [],
    descriptionEn: null,
    blurb: null,
    blurbEn: null,
    imageAlts: [],
    siteContent: null,
    submittedAt: '',
    approvedAt: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

const t = (key: string, params?: Record<string, unknown>) =>
  `${key}|${JSON.stringify(params ?? {})}`

describe('buildBrandFaq', () => {
  it('returns no FAQ for an empty profile', () => {
    expect(buildBrandFaq(makeBrand(), t)).toEqual([])
  })

  it('includes reputation when the summary has meaningful text', () => {
    const faq = buildBrandFaq(
      makeBrand({
        reputationSummary: {
          text: 'Known for reliable quality.',
          sources: [{ url: 'https://example.com/review' }],
        },
      }),
      t,
    )
    expect(faq.some((item) => item.id === 'reputation')).toBe(true)
  })

  it('does not expose retired FAQ categories', () => {
    const ids = buildBrandFaq(
      makeBrand({
        mitStatus: 'verified',
        purchaseWebsite: 'https://example.com',
        productTags: ['tea'],
        priceRange: 2,
        foundingYear: 2020,
        socialInstagram: 'brand',
        reputationSummary: {
          text: 'Known for reliable quality.',
          sources: [{ url: 'https://example.com/review' }],
        },
      }),
      t,
    ).map((item) => item.id)
    expect(ids).not.toEqual(
      expect.arrayContaining([
        'manufacturing',
        'certifications',
        'return-policy',
        'international-shipping',
      ]),
    )
  })
})
