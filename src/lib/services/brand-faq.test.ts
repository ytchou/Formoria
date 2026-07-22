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

const locationMessages = {
  'brandFaq.listSeparator': ', ',
  'sections.locationsAndRetailChannels': 'Locations & retail channels',
  'locations.confirmedHeading': 'Confirmed locations',
  'locations.stockDisclaimer':
    'The brand owner has confirmed only the location details. Check products and stock before visiting.',
  'locations.unconfirmedHeading': 'Locations to confirm',
  'locations.unconfirmedDisclaimer':
    'These listings are based on best-effort public information. Until the brand owner confirms them, we do not show an address, map pin, or directions.',
  'locations.chainHeading': 'Retail chains',
  'locations.chainDescription':
    'Availability varies by branch. The retailer link provides general retailer information, not live stock.',
} as const

const locationT = (key: string, params?: Record<string, unknown>) =>
  locationMessages[key as keyof typeof locationMessages] ?? t(key, params)

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

  it('includes a declared manufacturing story containing the locale verification marker', () => {
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

    expect(mitEntry?.answer).toContain('Products verified')
  })

  it('distinguishes confirmed locations, unconfirmed leads, and chain channels', () => {
    const faq = buildBrandFaq(
      makeBrand({
        retailLocations: [
          {
            kind: 'location',
            name: 'Confirmed Shop',
            relationshipType: 'brand_store',
            confirmationStatus: 'owner_confirmed',
            address: '1 Main Street',
          },
          {
            kind: 'location',
            name: 'Possible Stockist',
            relationshipType: 'stockist',
            confirmationStatus: 'unconfirmed',
            address: '2 Side Street',
          },
          {
            kind: 'retail_chain',
            name: 'Example Chain',
          },
        ],
      }),
      locationT,
      'en',
    )
    const locations = faq.find((item) => item.id === 'physical-stores')

    expect(locations?.question).toBe(
      'Locations & retail channels: Test Brand',
    )
    expect(locations?.answer).toContain('Confirmed locations (1): Confirmed Shop.')
    expect(locations?.answer).toContain('Locations to confirm (1): Possible Stockist.')
    expect(locations?.answer).toContain(
      'Retail chains (1): Example Chain. Availability varies by branch.',
    )
    expect(locations?.answer).toContain(
      'Availability is not live; check with the brand or retailer before visiting or ordering.',
    )
  })

  it('treats safely normalized legacy locations as unconfirmed leads', () => {
    const faq = buildBrandFaq(
      makeBrand({
        retailLocations: [
          {
            name: 'Legacy Location',
            address: '台北市大安區',
            confirmationStatus: 'owner_confirmed',
          },
        ] as unknown as Brand['retailLocations'],
      }),
      (key, params) => {
        const messages = {
          ...locationMessages,
          'brandFaq.listSeparator': '、',
          'sections.locationsAndRetailChannels': '地點與販售通路',
          'locations.confirmedHeading': '已確認地點',
          'locations.stockDisclaimer':
            '品牌主僅確認此地點資訊；前往前請先確認販售商品與庫存。',
          'locations.unconfirmedHeading': '待確認地點',
          'locations.unconfirmedDisclaimer':
            '以下資料是依公開資訊盡力整理。品牌主確認前，不會顯示地址、地圖標記或路線指引。',
          'locations.chainHeading': '連鎖販售通路',
          'locations.chainDescription':
            '各分店販售情況不同；通路連結僅提供零售商的一般資訊，不代表即時庫存。',
        }
        return messages[key as keyof typeof messages] ?? t(key, params)
      },
      'zh-TW',
    )
    const locations = faq.find((item) => item.id === 'physical-stores')

    expect(locations?.question).toBe('地點與販售通路: Test Brand')
    expect(locations?.answer).toContain('待確認地點 (1): Legacy Location.')
    expect(locations?.answer).not.toContain('已確認地點')
    expect(locations?.answer).toContain('造訪或下單前')
  })

  it('does not imply that a listed chain covers every branch or has live stock', () => {
    const faq = buildBrandFaq(
      makeBrand({
        retailLocations: [
          { kind: 'retail_chain', name: 'First Chain' },
          { kind: 'retail_chain', name: 'Second Chain' },
        ],
      }),
      locationT,
      'en',
    )
    const locations = faq.find((item) => item.id === 'physical-stores')

    expect(locations?.answer).toContain(
      'Retail chains (2): First Chain, Second Chain.',
    )
    expect(locations?.answer).toContain('Availability varies by branch.')
    expect(locations?.answer).toContain(
      'general retailer information, not live stock.',
    )
    expect(locations?.answer).toContain(
      'Availability is not live; check with the brand or retailer before visiting or ordering.',
    )
  })

  it('keeps generated location answers concise for large location sets', () => {
    const faq = buildBrandFaq(
      makeBrand({
        retailLocations: Array.from({ length: 5 }, (_, index) => ({
          kind: 'location' as const,
          name: `Confirmed Shop ${index + 1}`,
          relationshipType: 'brand_store' as const,
          confirmationStatus: 'owner_confirmed' as const,
          address: `${index + 1} Main Street`,
        })),
      }),
      locationT,
      'en',
    )
    const locations = faq.find((item) => item.id === 'physical-stores')

    expect(locations?.answer).toContain('Confirmed locations (5): Confirmed Shop 1, Confirmed Shop 2, Confirmed Shop 3, ….')
    expect(locations?.answer).not.toContain('Confirmed Shop 4')
  })
})
