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
    reputationSummary: null,
    manufacturing: null,
    certifications: null,
    policies: null,
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
    expect(withCategory?.answer).toContain('brandFaq.mainProducts.answerWithCategory')
    expect(withCategory?.answer).not.toContain('null')
    expect(withCategory?.answer).not.toContain(', including .')
    expect(withTags?.question).toContain('brandFaq.mainProducts.question')
    expect(withTags?.answer).toContain('brandFaq.mainProducts.answerWithTags')
    expect(withTags?.answer).not.toContain('null')
    expect(withTags?.answer).not.toContain(', including .')
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

  it('includes reputation when reputationSummary has text', () => {
    const faq = buildBrandFaq(
      makeFaqBrand({
        reputationSummary: {
          text: 'Known for reliable quality.',
          sources: [
            {
              url: 'https://example.com/reputation',
              title: 'Reputation source',
              retrievedAt: '2026-01-01T00:00:00Z',
            },
          ],
          retrievedAt: '2026-01-01T00:00:00Z',
        },
      }),
      mockT,
    )

    const [item] = faq
    expect(item?.question).toContain('brandFaq.reputation.question')
    expect(item?.answer).toContain('brandFaq.reputation.answer')
    expect(item?.answer).toContain('Known for reliable quality.')
  })

  it('omits reputation when reputationSummary is null', () => {
    expect(
      buildBrandFaq(makeFaqBrand({ reputationSummary: null }), mockT).some((item) =>
        item.question.includes('brandFaq.reputation.question'),
      ),
    ).toBe(false)
  })

  it('includes manufacturing when factoryLocation or productionModel exists', () => {
    const faq = buildBrandFaq(
      makeFaqBrand({
        manufacturing: {
          factoryLocation: 'Taichung, Taiwan',
          productionModel: 'own',
          notes: null,
          sources: [],
        },
      }),
      mockT,
    )

    const [item] = faq
    expect(item?.question).toContain('brandFaq.manufacturing.question')
    expect(item?.answer).toContain('brandFaq.manufacturing.answer')
    expect(item?.answer).toContain('Taichung, Taiwan')
    expect(item?.answer).toContain('own')
  })

  it('omits manufacturing when manufacturing is null', () => {
    expect(
      buildBrandFaq(makeFaqBrand({ manufacturing: null }), mockT).some((item) =>
        item.question.includes('brandFaq.manufacturing.question'),
      ),
    ).toBe(false)
  })

  it('includes certifications when certifications has items', () => {
    const faq = buildBrandFaq(
      makeFaqBrand({
        certifications: [
          {
            name: 'ISO 9001',
            issuer: 'ISO',
            year: 2024,
            source: null,
          },
        ],
      }),
      mockT,
    )

    const [item] = faq
    expect(item?.question).toContain('brandFaq.certifications.question')
    expect(item?.answer).toContain('brandFaq.certifications.answer')
    expect(item?.answer).toContain('ISO 9001')
  })

  it('omits certifications when certifications is null or empty', () => {
    expect(
      buildBrandFaq(makeFaqBrand({ certifications: null }), mockT).some((item) =>
        item.question.includes('brandFaq.certifications.question'),
      ),
    ).toBe(false)
    expect(
      buildBrandFaq(makeFaqBrand({ certifications: [] }), mockT).some((item) =>
        item.question.includes('brandFaq.certifications.question'),
      ),
    ).toBe(false)
  })

  it('includes returnPolicy when returns or warranty exists', () => {
    const faq = buildBrandFaq(
      makeFaqBrand({
        policies: {
          returns: '30-day returns available.',
          warranty: '1-year warranty included.',
          shipsInternational: null,
          sources: [],
        },
      }),
      mockT,
    )

    const [item] = faq
    expect(item?.question).toContain('brandFaq.returnPolicy.question')
    expect(item?.answer).toContain('brandFaq.returnPolicy.answer')
    expect(item?.answer).toContain('30-day returns available.')
    expect(item?.answer).toContain('1-year warranty included.')
  })

  it('omits returnPolicy when policies is null', () => {
    expect(
      buildBrandFaq(makeFaqBrand({ policies: null }), mockT).some((item) =>
        item.question.includes('brandFaq.returnPolicy.question'),
      ),
    ).toBe(false)
  })

  it('includes internationalShipping when shipsInternational is not null', () => {
    const faq = buildBrandFaq(
      makeFaqBrand({
        policies: {
          returns: null,
          warranty: null,
          shipsInternational: true,
          sources: [],
        },
      }),
      mockT,
    )

    const [item] = faq
    expect(item?.question).toContain('brandFaq.internationalShipping.question')
    expect(item?.answer).toContain('brandFaq.internationalShipping.answer')
    expect(item?.answer).toContain('internationally')
  })

  it('omits internationalShipping when policies is null', () => {
    expect(
      buildBrandFaq(makeFaqBrand({ policies: null }), mockT).some((item) =>
        item.question.includes('brandFaq.internationalShipping.question'),
      ),
    ).toBe(false)
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
        reputationSummary: {
          text: 'Well regarded.',
          sources: [],
          retrievedAt: '2026-01-01T00:00:00Z',
        },
        manufacturing: {
          factoryLocation: 'Taichung, Taiwan',
          productionModel: 'own',
          notes: null,
          sources: [],
        },
        certifications: [
          { name: 'ISO 9001', issuer: 'ISO', year: 2024, source: null },
        ],
        policies: {
          returns: '30-day returns.',
          warranty: '1-year warranty.',
          shipsInternational: true,
          sources: [],
        },
        socialInstagram: 'https://instagram.com/test',
        socialThreads: 'https://threads.net/@test',
        socialFacebook: 'https://facebook.com/test',
      }),
      mockT,
    )

    expect(faq).toHaveLength(12)
    expect(faq.map((item) => item.question)).toEqual([
      'brandFaq.isMadeInTaiwan.question|{"brandName":"Test Brand"}',
      'brandFaq.whereToBuy.question|{"brandName":"Test Brand"}',
      'brandFaq.hasPhysicalStores.question|{"brandName":"Test Brand"}',
      'brandFaq.mainProducts.question|{"brandName":"Test Brand"}',
      'brandFaq.priceRange.question|{"brandName":"Test Brand"}',
      'brandFaq.whenFounded.question|{"brandName":"Test Brand"}',
      'brandFaq.officialAccounts.question|{"brandName":"Test Brand"}',
      'brandFaq.reputation.question|{"brandName":"Test Brand"}',
      'brandFaq.manufacturing.question|{"brandName":"Test Brand"}',
      'brandFaq.certifications.question|{"brandName":"Test Brand"}',
      'brandFaq.returnPolicy.question|{"brandName":"Test Brand"}',
      'brandFaq.internationalShipping.question|{"brandName":"Test Brand"}',
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
