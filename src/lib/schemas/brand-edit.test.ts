import { describe, it, expect } from 'vitest'
import {
  basicInfoSchema,
  brandEditSchema,
  brandPublishSchema,
  SECTION_FIELDS,
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

  it('requires an address when a retail location row has data', () => {
    const result = brandEditSchema.safeParse({
      retailLocations: [{ relationshipType: 'stockist' }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts a retail location with a manual address', () => {
    const result = brandEditSchema.safeParse({
      retailLocations: [
        {
          relationshipType: 'stockist',
          address: '新北市林口區忠孝路 82號',
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('blocks duplicate retail locations', () => {
    const result = brandEditSchema.safeParse({
      retailLocations: [
        {
          relationshipType: 'stockist',
          address: 'Taipei 101',
        },
        {
          relationshipType: 'brand_store',
          address: ' Taipei   101 ',
        },
      ],
    })

    expect(result.success).toBe(false)
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
