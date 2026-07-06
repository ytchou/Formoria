import { describe, it, expect } from 'vitest'
import {
  basicInfoSchema,
  mediaSchema,
  linksSchema,
  customerVoicesSchema,
  locationsSchema,
  reputationSchema,
  manufacturingSchema,
  certificationsSchema,
  policiesSchema,
  brandEditSchema,
  SECTION_FIELDS,
  ONBOARDING_STEP_TO_WIZARD_STEP,
} from './brand-edit'

describe('basicInfoSchema', () => {
  it('passes with valid minimal data', () => {
    const result = basicInfoSchema.safeParse({ name: 'Test Brand', productType: 'fashion' })
    expect(result.success).toBe(true)
  })
  it('fails when name is empty', () => {
    const result = basicInfoSchema.safeParse({ name: '', productType: 'fashion' })
    expect(result.success).toBe(false)
  })
  it('fails when productTags exceeds 5', () => {
    const result = basicInfoSchema.safeParse({
      name: 'X', productType: 'fashion',
      productTags: ['a','b','c','d','e','f'],
    })
    expect(result.success).toBe(false)
  })
  it('fails when a productTag exceeds 40 chars', () => {
    const result = basicInfoSchema.safeParse({
      name: 'X', productType: 'fashion',
      productTags: ['a'.repeat(41)],
    })
    expect(result.success).toBe(false)
  })
})

describe('customerVoicesSchema', () => {
  it('fails when customerVoices exceeds 5 items', () => {
    const voice = { author: 'A', content: 'B', source: 'C' }
    const result = customerVoicesSchema.safeParse({ customerVoices: Array(6).fill(voice) })
    expect(result.success).toBe(false)
  })
})

describe('brandEditSchema', () => {
  it('is a merge of all 9 section schemas', () => {
    const result = brandEditSchema.safeParse({ name: 'Brand', productType: 'food' })
    expect(result.success).toBe(true)
  })
})

describe('SECTION_FIELDS', () => {
  it('has entries for all 9 sections', () => {
    const expected = ['basicInfo','media','links','customerVoices','locations',
      'reputation','manufacturing','certifications','policies']
    expected.forEach(k => expect(SECTION_FIELDS).toHaveProperty(k))
  })
  it('includes name in basicInfo fields', () => {
    expect(SECTION_FIELDS.basicInfo).toContain('name')
  })
})

describe('ONBOARDING_STEP_TO_WIZARD_STEP', () => {
  it('maps all 5 onboarding step keys to wizard step indices', () => {
    expect(ONBOARDING_STEP_TO_WIZARD_STEP.basics).toBe(0)
    expect(ONBOARDING_STEP_TO_WIZARD_STEP.products).toBe(0)
    expect(ONBOARDING_STEP_TO_WIZARD_STEP.story_media).toBe(0)
    expect(ONBOARDING_STEP_TO_WIZARD_STEP.purchase).toBe(2)
    expect(ONBOARDING_STEP_TO_WIZARD_STEP.social_proof).toBe(2)
  })
})
