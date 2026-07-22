import { describe, expect, it, vi } from 'vitest'
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

  it('renders no MIT FAQ entry for unverified brands with enrichment signals only', () => {
    const faq = buildBrandFaq(
      makeBrand({
        mitStatus: 'unverified',
        mitStory: '我們的工廠在台南',
        mitEvidence: {
          enrichment_signals: ['official_site_claims_mit'],
        } as unknown as Brand['mitEvidence'],
      }),
      t,
    )

    expect(faq.some((item) => item.id === 'made-in-taiwan')).toBe(false)
  })

  it('renders a declared-scoped answer for declared brands', () => {
    const translate = vi.fn(t)
    const faq = buildBrandFaq(
      makeBrand({ mitStatus: 'declared', mitDeclaredScope: 'most' }),
      translate,
    )
    const mitEntry = faq.find((item) => item.id === 'made-in-taiwan')

    expect(translate).toHaveBeenCalledWith(
      'brandFaq.isMadeInTaiwan.scopeLabels.most',
    )
    expect(translate).toHaveBeenCalledWith(
      'brandFaq.isMadeInTaiwan.declaredAnswer',
      {
        brandName: 'Test Brand',
        scope: 'brandFaq.isMadeInTaiwan.scopeLabels.most|{}',
      },
    )
    expect(translate).not.toHaveBeenCalledWith(
      'brandFaq.isMadeInTaiwan.answer',
      expect.anything(),
    )
    expect(mitEntry?.answer).toContain(
      'brandFaq.isMadeInTaiwan.declaredAnswer',
    )
  })

  it('omits a declared manufacturing story containing the locale verification marker', () => {
    const translate = (key: string, params?: Record<string, unknown>) => {
      if (key === 'brandFaq.isMadeInTaiwan.verificationMarker') return 'verified'
      return t(key, params)
    }
    const faq = buildBrandFaq(
      makeBrand({
        mitStatus: 'declared',
        mitStory: 'Products verified by an external registry.',
      }),
      translate,
      'en',
    )
    const mitEntry = faq.find((item) => item.id === 'made-in-taiwan')

    expect(mitEntry?.answer).not.toContain('Products verified')
  })
})
