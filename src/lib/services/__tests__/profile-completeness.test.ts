import { describe, expect, it } from 'vitest'
import { computeProfileCompleteness } from '../profile-completeness'
import type { Brand } from '@/lib/types/brand'

const EMPTY = {
  description: null,
  productTags: [],
  priceRange: null,
  heroImageUrl: null,
  productPhotos: [],
  purchaseWebsite: null,
  city: null,
  foundingYear: null,
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchasePinkoi: null,
  purchaseShopee: null,
  otherUrls: [],
  retailLocations: [],
  reputationSummary: null,
} satisfies Pick<
  Brand,
  | 'description'
  | 'productTags'
  | 'priceRange'
  | 'heroImageUrl'
  | 'productPhotos'
  | 'purchaseWebsite'
  | 'city'
  | 'foundingYear'
  | 'socialInstagram'
  | 'socialThreads'
  | 'socialFacebook'
  | 'purchasePinkoi'
  | 'purchaseShopee'
  | 'otherUrls'
  | 'retailLocations'
  | 'reputationSummary'
>

describe('computeProfileCompleteness', () => {
  it('scores an empty profile as zero with required recommendations first', () => {
    const result = computeProfileCompleteness(EMPTY)
    expect(result).toMatchObject({ score: 0, completed: 0, total: 12 })
    expect(
      result.recommendations.slice(0, 5).every((item) => item.required),
    ).toBe(true)
  })

  it('scores all components as 100', () => {
    const result = computeProfileCompleteness({
      ...EMPTY,
      description: 'Story',
      productTags: ['tea'],
      priceRange: 2,
      heroImageUrl: 'https://example.com/hero.webp',
      productPhotos: ['https://example.com/product.webp'],
      purchaseWebsite: 'https://example.com',
      city: 'taipei',
      foundingYear: 2020,
      socialInstagram: 'brand',
      purchasePinkoi: 'https://pinkoi.com/store/brand',
      retailLocations: [
        {
          kind: 'location',
          name: 'Shop',
          relationshipType: 'stockist',
          confirmationStatus: 'unconfirmed',
          address: '',
          latitude: 0,
          longitude: 0,
        },
      ],
      reputationSummary: {
        text: 'Trusted',
        sources: [{ url: 'https://example.com/review' }],
      },
    })
    expect(result).toMatchObject({
      score: 100,
      completed: 12,
      total: 12,
      recommendations: [],
    })
  })

  it('groups social and additional sales channels', () => {
    const result = computeProfileCompleteness({
      ...EMPTY,
      socialThreads: 'brand',
      otherUrls: [{ label: 'Store', url: 'https://shop.example.com' }],
    })
    expect(
      result.components.find((item) => item.key === 'socialPresence')?.complete,
    ).toBe(true)
    expect(
      result.components.find((item) => item.key === 'additionalSalesChannel')
        ?.complete,
    ).toBe(true)
    expect(result.score).toBe(14)
  })

  it('counts unconfirmed locations and retail-chain channels as complete', () => {
    for (const retailLocations of [
      [
        {
          kind: 'location' as const,
          name: 'Possible Shop',
          relationshipType: 'stockist' as const,
          confirmationStatus: 'unconfirmed' as const,
          address: '台北市大安區',
        },
      ],
      [{ kind: 'retail_chain' as const, name: 'Example Chain' }],
    ]) {
      const result = computeProfileCompleteness({
        ...EMPTY,
        retailLocations,
      })

      expect(
        result.components.find((item) => item.key === 'retailLocations')
          ?.complete,
      ).toBe(true)
    }
  })

  it('counts safely normalized legacy location and chain data as complete', () => {
    for (const retailLocations of [
      [
        {
          name: 'Legacy Shop',
          address: '台北市信義區',
          confirmationStatus: 'owner_confirmed',
        },
      ],
      [{ name: 'Legacy Chain', type: 'chain' }],
    ]) {
      const result = computeProfileCompleteness({
        ...EMPTY,
        retailLocations: retailLocations as unknown as Brand['retailLocations'],
      })

      expect(
        result.components.find((item) => item.key === 'retailLocations')
          ?.complete,
      ).toBe(true)
    }
  })

  it('requires both reputation text and a source URL', () => {
    const result = computeProfileCompleteness({
      ...EMPTY,
      reputationSummary: { text: 'Trusted', sources: [] },
    })
    expect(
      result.components.find((item) => item.key === 'reputation')?.complete,
    ).toBe(false)
  })

  it('does not count malformed website or evidence URLs', () => {
    const result = computeProfileCompleteness({
      ...EMPTY,
      purchaseWebsite: 'not-a-url',
      reputationSummary: { text: 'Trusted', sources: [{ url: 'not-a-url' }] },
    })
    expect(
      result.components.find((item) => item.key === 'officialWebsite')?.complete,
    ).toBe(false)
    expect(
      result.components.find((item) => item.key === 'reputation')?.complete,
    ).toBe(false)
  })
})
