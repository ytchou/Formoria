import { describe, expect, it } from 'vitest'
import {
  SUBMISSION_SECTION_FIELDS,
  SUBMISSION_WIZARD_STEPS,
  submissionWizardRequiredSchema,
  submissionWizardSchema,
} from '@/lib/schemas/submission-wizard'

const completeWizardData = {
  name: 'Greenroom Leather',
  website: 'https://greenroom.tw',
  description: 'Handcrafted leather goods from Tainan',
  productType: 'bags-accessories',
  foundingYear: 2018,
  productTags: ['leather', 'handmade'],
  city: 'tainan',
  priceRange: 2,
  mitStory: 'Made by local craftspeople.',
  heroImageUrl: 'https://storage.example.com/hero.webp',
  productPhotos: ['https://storage.example.com/p1.webp'],
  socialInstagram: 'https://instagram.com/greenroom',
  socialThreads: '',
  socialFacebook: '',
  purchaseWebsite: 'https://greenroom.tw/shop',
  purchasePinkoi: '',
  purchaseShopee: '',
  otherUrls: [],
}

describe('submissionWizardSchema', () => {
  it('accepts valid complete wizard data', () => {
    expect(submissionWizardSchema.safeParse(completeWizardData).success).toBe(
      true,
    )
  })

  it('accepts minimal wizard data', () => {
    expect(
      submissionWizardSchema.safeParse({
        name: 'Greenroom Leather',
        website: 'https://greenroom.tw',
        description: 'Handcrafted leather goods from Tainan',
      }).success,
    ).toBe(true)
  })

  it('rejects missing name', () => {
    expect(
      submissionWizardSchema.safeParse({
        website: 'https://greenroom.tw',
        description: 'Handcrafted leather goods from Tainan',
      }).success,
    ).toBe(false)
  })

  it('rejects an invalid website URL', () => {
    expect(
      submissionWizardSchema.safeParse({
        ...completeWizardData,
        website: 'greenroom.tw',
      }).success,
    ).toBe(false)
  })

  it('shares handle-or-URL social validation with dashboard editing', () => {
    expect(
      submissionWizardSchema.safeParse({
        ...completeWizardData,
        socialInstagram: '@greenroom.tw',
        socialThreads: 'greenroom.tw',
      }).success,
    ).toBe(true)
  })

  it('rejects partial other links', () => {
    expect(
      submissionWizardSchema.safeParse({
        ...completeWizardData,
        otherUrls: [{ label: 'Stockist', url: '' }],
      }).success,
    ).toBe(false)
  })
})

describe('submissionWizardRequiredSchema', () => {
  it('rejects missing heroImageUrl', () => {
    expect(
      submissionWizardRequiredSchema.safeParse({
        name: 'Greenroom Leather',
        website: 'https://greenroom.tw',
        description: 'Handcrafted leather goods from Tainan',
      }).success,
    ).toBe(false)
  })
})

describe('submission wizard steps', () => {
  it('defines three steps', () => {
    expect(SUBMISSION_WIZARD_STEPS).toHaveLength(3)
  })

  it('maps every step key to a non-empty field list', () => {
    for (const { key } of SUBMISSION_WIZARD_STEPS) {
      expect(SUBMISSION_SECTION_FIELDS[key].length).toBeGreaterThan(0)
    }
  })
})
