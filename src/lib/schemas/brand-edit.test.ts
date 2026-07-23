import { describe, it, expect } from 'vitest'
import {
  basicInfoSchema,
  brandEditSchema,
  brandPublishSchema,
  SECTION_FIELDS,
  areAllWizardStepsComplete,
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
  it('is a merge of all section schemas', () => {
    const result = brandEditSchema.safeParse({
      name: 'Brand',
      productType: 'food',
    })
    expect(result.success).toBe(true)
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
    const expected = ['basicInfo', 'media', 'links', 'reputation']
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
