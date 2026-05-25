import { describe, it, expect } from 'vitest'
import { createSubmissionSchema, SOURCE_ATTRIBUTION_VALUES } from '../submission'

const basePayload = {
  name: 'Test Brand',
  description: 'A test brand description with enough characters',
  category: 'fashion',
  tags: ['clothing', 'accessories'],
  isOwner: false,
  pdpaConsent: true,
  socialLinks: { instagram: '', threads: '', facebook: '', website: 'https://testbrand.com' },
  productPhotos: [],
  brandHighlights: '',
  retailLocations: [],
  turnstileToken: 'test-token',
}

describe('createSubmissionSchema', () => {
  describe('owner path (isOwner=true)', () => {
    const schema = createSubmissionSchema(true)

    it('fails without logoUrl', () => {
      const result = schema.safeParse({ ...basePayload, isOwner: true })
      expect(result.success).toBe(false)
      expect(result.error?.issues.some(i => i.path.includes('logoUrl'))).toBe(true)
    })

    it('fails with empty purchaseLinks', () => {
      const result = schema.safeParse({
        ...basePayload,
        isOwner: true,
        logoUrl: 'https://cdn.example.com/logo.png',
        purchaseLinks: [],
      })
      expect(result.success).toBe(false)
      expect(result.error?.issues.some(i => i.path.includes('purchaseLinks'))).toBe(true)
    })

    it('passes with logoUrl and at least one purchaseLink', () => {
      const result = schema.safeParse({
        ...basePayload,
        isOwner: true,
        logoUrl: 'https://cdn.example.com/logo.png',
        purchaseLinks: [{ platform: 'shopify', url: 'https://shop.example.com' }],
      })
      expect(result.success).toBe(true)
    })
  })

  describe('community path (isOwner=false)', () => {
    const schema = createSubmissionSchema(false)

    it('passes without logoUrl', () => {
      const result = schema.safeParse({ ...basePayload })
      expect(result.success).toBe(true)
    })

    it('passes with empty purchaseLinks', () => {
      const result = schema.safeParse({ ...basePayload, purchaseLinks: [] })
      expect(result.success).toBe(true)
    })

    it('accepts valid sourceAttribution', () => {
      const result = schema.safeParse({
        ...basePayload,
        sourceAttribution: 'found_online',
      })
      expect(result.success).toBe(true)
    })

    it('rejects invalid sourceAttribution value', () => {
      const result = schema.safeParse({
        ...basePayload,
        sourceAttribution: 'invalid_value',
      })
      expect(result.success).toBe(false)
    })

    it('passes without sourceAttribution (optional)', () => {
      const result = schema.safeParse({ ...basePayload })
      expect(result.success).toBe(true)
    })
  })

  describe('SOURCE_ATTRIBUTION_VALUES', () => {
    it('contains all expected values', () => {
      expect(SOURCE_ATTRIBUTION_VALUES).toEqual([
        'bought_product',
        'saw_at_market',
        'found_online',
        'friend_recommended',
        'work_there',
      ])
    })
  })
})
