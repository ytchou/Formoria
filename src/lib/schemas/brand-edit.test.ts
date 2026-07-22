import { describe, it, expect } from 'vitest'
import {
  basicInfoSchema,
  brandEditSchema,
  brandPublishSchema,
  SECTION_FIELDS,
  areAllWizardStepsComplete,
  getOnboardingStepHref,
} from './brand-edit'

describe('basicInfoSchema', () => {
  it('passes with valid minimal data', () => {
    const result = basicInfoSchema.safeParse({
      name: 'Test Brand',
      productType: 'fashion',
    })
    expect(result.success).toBe(true)
  })
  it('allows an empty name in a draft', () => {
    const result = basicInfoSchema.safeParse({
      name: '',
      productType: 'fashion',
    })
    expect(result.success).toBe(true)
  })
  it('fails when productTags exceeds 5', () => {
    const result = basicInfoSchema.safeParse({
      name: 'X',
      productType: 'fashion',
      productTags: ['a', 'b', 'c', 'd', 'e', 'f'],
    })
    expect(result.success).toBe(false)
  })
  it('fails when a productTag exceeds 40 chars', () => {
    const result = basicInfoSchema.safeParse({
      name: 'X',
      productType: 'fashion',
      productTags: ['a'.repeat(41)],
    })
    expect(result.success).toBe(false)
  })
})

describe('brandEditSchema', () => {
  it('is a merge of all five section schemas', () => {
    const result = brandEditSchema.safeParse({
      name: 'Brand',
      productType: 'food',
    })
    expect(result.success).toBe(true)
  })

  it('allows empty location drafts but requires a name for meaningful data', () => {
    expect(
      brandEditSchema.safeParse({
        retailLocations: [{ kind: 'location', relationshipType: 'stockist' }],
      }).success,
    ).toBe(true)

    const result = brandEditSchema.safeParse({
      retailLocations: [{ address: 'Taipei 101' }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts a named legacy retail location with a manual address', () => {
    const result = brandEditSchema.safeParse({
      retailLocations: [
        {
          name: '林口門市',
          relationshipType: 'stockist',
          address: '新北市林口區忠孝路 82號',
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('requires an address for canonical owner-confirmed physical locations', () => {
    expect(
      brandEditSchema.safeParse({
        retailLocations: [
          {
            kind: 'location',
            name: 'Flagship',
            relationshipType: 'brand_store',
            confirmationStatus: 'owner_confirmed',
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('validates canonical chain URLs as HTTP(S)', () => {
    const chain = { kind: 'retail_chain', name: 'Chain' }
    expect(
      brandEditSchema.safeParse({
        retailLocations: [{ ...chain, retailerUrl: 'https://example.com/find' }],
      }).success,
    ).toBe(true)
    expect(
      brandEditSchema.safeParse({
        retailLocations: [{ ...chain, retailerUrl: 'ftp://example.com' }],
      }).success,
    ).toBe(false)
  })

  it('rejects meaningful location-only data on canonical chains', () => {
    expect(
      brandEditSchema.safeParse({
        retailLocations: [
          { kind: 'retail_chain', name: 'Chain', address: 'Taipei 101' },
        ],
      }).success,
    ).toBe(false)
    expect(
      brandEditSchema.safeParse({
        retailLocations: [
          {
            kind: 'retail_chain',
            name: 'Chain',
            relationshipType: 'stockist',
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('blocks duplicate retail locations', () => {
    const result = brandEditSchema.safeParse({
      retailLocations: [
        {
          name: 'Taipei 101 shop',
          relationshipType: 'stockist',
          address: 'Taipei 101',
        },
        {
          name: 'Taipei 101 counter',
          relationshipType: 'brand_store',
          address: ' Taipei   101 ',
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('blocks duplicate canonical chains while allowing a physical branch', () => {
    expect(
      brandEditSchema.safeParse({
        retailLocations: [
          { kind: 'retail_chain', name: 'Retail Chain' },
          { kind: 'retail_chain', name: ' retail   chain ' },
        ],
      }).success,
    ).toBe(false)
    expect(
      brandEditSchema.safeParse({
        retailLocations: [
          { kind: 'retail_chain', name: 'Retail Chain' },
          {
            kind: 'location',
            name: 'Retail Chain',
            relationshipType: 'stockist',
            address: 'No. 1',
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('accepts a romanized name and social handles', () => {
    const result = brandEditSchema.safeParse({
      romanizedName: 'Warmwood Living',
      socialInstagram: '@warmwood.living',
      socialThreads: 'warmwood.living',
    })

    expect(result.success).toBe(true)
  })

  it('requires both values in a partially completed other link', () => {
    expect(
      brandEditSchema.safeParse({
        otherUrls: [{ label: '', url: 'https://example.com' }],
      }).success,
    ).toBe(false)
    expect(
      brandEditSchema.safeParse({
        otherUrls: [{ label: 'Retailer', url: '' }],
      }).success,
    ).toBe(false)
    expect(
      brandEditSchema.safeParse({
        otherUrls: [{ label: '', url: '' }],
      }).success,
    ).toBe(true)
  })
})

describe('brandPublishSchema', () => {
  it('requires every owner publish field', () => {
    expect(
      brandPublishSchema.safeParse({ name: '', productType: '' }).success,
    ).toBe(false)
  })

  it('accepts a complete required profile', () => {
    expect(
      brandPublishSchema.safeParse({
        name: 'Brand',
        productType: 'food',
        description: 'Story',
        productTags: ['tea'],
        priceRange: 2,
        heroImageUrl: 'https://example.com/hero.webp',
        productPhotos: ['https://example.com/product.webp'],
        purchaseWebsite: 'https://example.com',
      }).success,
    ).toBe(true)
  })
})

describe('SECTION_FIELDS', () => {
  it('has entries for all five sections', () => {
    const expected = ['basicInfo', 'media', 'links', 'locations', 'reputation']
    expected.forEach((k) => expect(SECTION_FIELDS).toHaveProperty(k))
  })
  it('includes name in basicInfo fields', () => {
    expect(SECTION_FIELDS.basicInfo).toContain('name')
    expect(SECTION_FIELDS.basicInfo).toContain('romanizedName')
  })
})

describe('areAllWizardStepsComplete', () => {
  it('requires every wizard index rather than only the count', () => {
    expect(areAllWizardStepsComplete([0, 1, 2, 3, 4])).toBe(true)
    expect(areAllWizardStepsComplete([0, 1, 2, 4])).toBe(false)
    expect(areAllWizardStepsComplete([0, 1, 2, 3, 4, 9])).toBe(true)
  })
})

describe('getOnboardingStepHref', () => {
  it('maps brand_basics and media_links to edit wizard steps', () => {
    expect(getOnboardingStepHref('brand_basics', 'test-brand')).toBe(
      '/dashboard/brands/test-brand/edit?step=0',
    )
    expect(getOnboardingStepHref('media_links', 'test-brand')).toBe(
      '/dashboard/brands/test-brand/edit?step=1',
    )
  })

  it('maps analytics, health, verification to dashboard routes', () => {
    expect(getOnboardingStepHref('analytics', 'test-brand')).toBe(
      '/dashboard/brands/test-brand/analytics',
    )
    expect(getOnboardingStepHref('health', 'test-brand')).toBe(
      '/dashboard/brands/test-brand#profile-completeness',
    )
    expect(getOnboardingStepHref('verification', 'test-brand')).toBe(
      '/dashboard/brands/test-brand#verification',
    )
  })
})
