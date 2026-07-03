import { describe, expect, it } from 'vitest'
import type { Brand } from '@/lib/types'
import { buildBrandFaq, buildBrandIntro } from '@/lib/services/brand-faq'

function makeFaqBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'brand-1',
    name: 'Test Brand',
    slug: 'test-brand',
    description: null,
    heroImageUrl: null,
    status: 'approved',
    category: null,
    isVerified: false,
    mitStatus: 'unverified',
    mitVerifiedAt: null,
    mitEvidence: null,
    mitVerified: false,
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
    customerVoices: [],
    productPhotos: [],
    contactEmail: null,
    priceRange: null,
    productTags: [],
    siteContent: null,
    submittedAt: '2026-01-01T00:00:00Z',
    approvedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function mockT(key: string, params?: Record<string, unknown>): string {
  return `${key}|${JSON.stringify(params ?? {})}`
}

describe('buildBrandFaq', () => {
  it('returns an empty array when no data qualifies', () => {
    expect(buildBrandFaq(makeFaqBrand(), mockT)).toEqual([])
  })

  it('includes isMadeInTaiwan only when mitStatus is verified', () => {
    expect(buildBrandFaq(makeFaqBrand({ mitStatus: 'verified' }), mockT)).toEqual([
      {
        question: 'brandFaq.isMadeInTaiwan.question|{"brandName":"Test Brand"}',
        answer: 'brandFaq.isMadeInTaiwan.answer|{"brandName":"Test Brand"}',
      },
    ])

    expect(buildBrandFaq(makeFaqBrand({ mitStatus: 'unverified' }), mockT)).toEqual([])
    expect(buildBrandFaq(makeFaqBrand({ mitStatus: undefined }), mockT)).toEqual([])
  })

  it('includes whereToBuy when any purchase link exists', () => {
    const faq = buildBrandFaq(makeFaqBrand({ purchaseWebsite: 'https://example.com' }), mockT)
    const [item] = faq
    expect(faq).toHaveLength(1)
    expect(item?.question).toContain('brandFaq.whereToBuy.question')
    expect(item?.answer).toContain('brandFaq.whereToBuy.answer')
  })

  it('includes hasPhysicalStores when retailLocations is non-empty', () => {
    const faq = buildBrandFaq(
      makeFaqBrand({
        retailLocations: [
          { name: 'Store A', address: 'A', latitude: 1, longitude: 1 },
        ],
      }),
      mockT,
    )
    const [item] = faq
    expect(item?.question).toContain('brandFaq.hasPhysicalStores.question')
    expect(item?.answer).toContain('Store A')
  })

  it('includes mainProducts when category or productTags exist', () => {
    const [withCategory] = buildBrandFaq(makeFaqBrand({ category: 'Food' }), mockT)
    const [withTags] = buildBrandFaq(makeFaqBrand({ productTags: ['soap'] }), mockT)
    expect(withCategory?.question).toContain('brandFaq.mainProducts.question')
    expect(withTags?.question).toContain('brandFaq.mainProducts.question')
  })

  it('includes priceRange only for valid values', () => {
    const [budget] = buildBrandFaq(makeFaqBrand({ priceRange: 1 }), mockT)
    const [midRange] = buildBrandFaq(makeFaqBrand({ priceRange: 2 }), mockT)
    const [premium] = buildBrandFaq(makeFaqBrand({ priceRange: 3 }), mockT)
    expect(budget?.question).toContain('brandFaq.priceRange.question')
    expect(midRange?.question).toContain('brandFaq.priceRange.question')
    expect(premium?.question).toContain('brandFaq.priceRange.question')
    expect(buildBrandFaq(makeFaqBrand({ priceRange: 0 }), mockT)).toEqual([])
    expect(buildBrandFaq(makeFaqBrand({ priceRange: null }), mockT)).toEqual([])
  })

  it('includes whenFounded when foundingYear exists', () => {
    const faq = buildBrandFaq(makeFaqBrand({ foundingYear: 2010 }), mockT)
    const [item] = faq
    expect(item?.question).toContain('brandFaq.whenFounded.question')
    expect(item?.answer).toContain('2010')
  })

  it('includes officialAccounts when any social link exists', () => {
    const faq = buildBrandFaq(makeFaqBrand({ socialThreads: 'https://threads.net/@test' }), mockT)
    const [item] = faq
    expect(item?.question).toContain('brandFaq.officialAccounts.question')
    expect(item?.answer).toContain('Threads')
  })

  it('returns all seven questions for a fully populated brand', () => {
    const faq = buildBrandFaq(
      makeFaqBrand({
        mitStatus: 'verified',
        purchaseWebsite: 'https://example.com',
        purchasePinkoi: 'https://pinkoi.com/test',
        purchaseShopee: 'https://shopee.tw/test',
        retailLocations: [
          { name: 'Store A', address: 'A', latitude: 1, longitude: 1 },
          { name: 'Store B', address: 'B', latitude: 2, longitude: 2 },
          { name: 'Store C', address: 'C', latitude: 3, longitude: 3 },
        ],
        category: 'Food',
        productTags: ['soap', 'lotion'],
        priceRange: 2,
        foundingYear: 2012,
        socialInstagram: 'https://instagram.com/test',
        socialThreads: 'https://threads.net/@test',
        socialFacebook: 'https://facebook.com/test',
      }),
      mockT,
    )

    expect(faq).toHaveLength(7)
    expect(faq.map((item) => item.question)).toEqual([
      'brandFaq.isMadeInTaiwan.question|{"brandName":"Test Brand"}',
      'brandFaq.whereToBuy.question|{"brandName":"Test Brand"}',
      'brandFaq.hasPhysicalStores.question|{"brandName":"Test Brand"}',
      'brandFaq.mainProducts.question|{"brandName":"Test Brand"}',
      'brandFaq.priceRange.question|{"brandName":"Test Brand"}',
      'brandFaq.whenFounded.question|{"brandName":"Test Brand"}',
      'brandFaq.officialAccounts.question|{"brandName":"Test Brand"}',
    ])
  })

  it('never mentions contactEmail in any answer text', () => {
    const faq = buildBrandFaq(
      makeFaqBrand({
        mitStatus: 'verified',
        contactEmail: 'hello@test.com',
        purchaseWebsite: 'https://example.com',
        retailLocations: [{ name: 'Store A', address: 'A', latitude: 1, longitude: 1 }],
        category: 'Food',
        priceRange: 1,
        foundingYear: 2010,
        socialInstagram: 'https://instagram.com/test',
      }),
      mockT,
    )

    expect(faq.some((item) => item.answer.includes('contactEmail'))).toBe(false)
    expect(faq.some((item) => item.answer.includes('hello@test.com'))).toBe(false)
  })

  it('truncates long retail location lists to three items', () => {
    const faq = buildBrandFaq(
      makeFaqBrand({
        retailLocations: [
          { name: 'Store A', address: 'A', latitude: 1, longitude: 1 },
          { name: 'Store B', address: 'B', latitude: 2, longitude: 2 },
          { name: 'Store C', address: 'C', latitude: 3, longitude: 3 },
          { name: 'Store D', address: 'D', latitude: 4, longitude: 4 },
          { name: 'Store E', address: 'E', latitude: 5, longitude: 5 },
        ],
      }),
      mockT,
    )

    const [item] = faq
    expect(item?.answer).toContain('Store A')
    expect(item?.answer).toContain('Store B')
    expect(item?.answer).toContain('Store C')
    expect(item?.answer).not.toContain('Store D')
    expect(item?.answer).not.toContain('Store E')
  })
})

describe('buildBrandIntro', () => {
  it('returns a non-empty string for a minimal brand', () => {
    expect(buildBrandIntro(makeFaqBrand(), mockT)).toBeTruthy()
  })

  it('always includes the identity sentence, with category when present', () => {
    expect(buildBrandIntro(makeFaqBrand(), mockT)).toContain('brandIntro.identityNoCat|{"brandName":"Test Brand"}')
    expect(buildBrandIntro(makeFaqBrand({ category: 'Food' }), mockT)).toContain(
      'brandIntro.identity|{"brandName":"Test Brand","category":"Food"}',
    )
  })

  it('includes founded when foundingYear exists', () => {
    expect(buildBrandIntro(makeFaqBrand({ foundingYear: 2010 }), mockT)).toContain('brandIntro.founded|{"year":2010}')
  })

  it('includes mitVerified only for verified brands', () => {
    expect(buildBrandIntro(makeFaqBrand({ mitStatus: 'verified' }), mockT)).toContain('brandIntro.mitVerified|{}')
    expect(buildBrandIntro(makeFaqBrand({ mitStatus: 'unverified' }), mockT)).not.toContain('brandIntro.mitVerified|{}')
  })

  it('includes price when priceRange is valid', () => {
    expect(buildBrandIntro(makeFaqBrand({ priceRange: 1 }), mockT)).toContain('brandIntro.price|{"range":"brandFaq.priceRanges.budget|{}"}')
    expect(buildBrandIntro(makeFaqBrand({ priceRange: 2 }), mockT)).toContain('brandIntro.price|{"range":"brandFaq.priceRanges.midRange|{}"}')
    expect(buildBrandIntro(makeFaqBrand({ priceRange: 3 }), mockT)).toContain('brandIntro.price|{"range":"brandFaq.priceRanges.premium|{}"}')
  })

  it('includes purchase when any purchase link exists', () => {
    expect(buildBrandIntro(makeFaqBrand({ purchasePinkoi: 'https://pinkoi.com/test' }), mockT)).toContain(
      'brandIntro.purchase|{"channels":"',
    )
  })
})
