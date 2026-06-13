import { describe, expect, it } from 'vitest'
import { descriptionField, fullSubmissionSchema } from '../submission'

describe('descriptionField min length', () => {
  it('rejects descriptions shorter than 40 characters', () => {
    expect(descriptionField.safeParse('x'.repeat(39)).success).toBe(false)
  })
  it('accepts descriptions of 40+ characters', () => {
    expect(descriptionField.safeParse('x'.repeat(40)).success).toBe(true)
  })
})

describe('fullSubmissionSchema product type validation', () => {
  const baseValid = {
    name: '測試品牌',
    description: '這是一段至少四十個字元的品牌介紹，用來符合提交流程的基本驗證需求，請確認字數足夠長。',
    category: 'fashion',
    region: 'taipei',
    valueTags: [],
    logoUrl: 'https://example.com/logo.webp',
    productPhotos: [],
    brandHighlights: '',
    purchaseLinks: [{ platform: 'website', url: 'https://example.com/shop' }],
    socialLinks: {
      instagram: '',
      threads: '',
      facebook: '',
      website: 'https://example.com',
    },
    retailLocations: [],
    pdpaConsent: true,
    turnstileToken: 'valid-token',
  }

  it('passes with at least one productType selected', () => {
    const result = fullSubmissionSchema.safeParse({
      ...baseValid,
      productTypes: ['fashion'],
      productTypeNote: '',
    })

    expect(result.success).toBe(true)
  })

  it('fails when productTypes is empty and no productTypeNote', () => {
    const result = fullSubmissionSchema.safeParse({
      ...baseValid,
      productTypes: [],
      productTypeNote: '',
    })

    expect(result.success).toBe(false)
  })

  it("passes when productTypes is empty but productTypeNote is provided ('手工皮件')", () => {
    const result = fullSubmissionSchema.safeParse({
      ...baseValid,
      productTypes: [],
      productTypeNote: '手工皮件',
    })

    expect(result.success).toBe(true)
  })

  it('fails when productTypeNote exceeds 200 chars', () => {
    const result = fullSubmissionSchema.safeParse({
      ...baseValid,
      productTypes: [],
      productTypeNote: '字'.repeat(201),
    })

    expect(result.success).toBe(false)
  })

  it('passes with both productTypes and productTypeNote', () => {
    const result = fullSubmissionSchema.safeParse({
      ...baseValid,
      productTypes: ['fashion'],
      productTypeNote: '手工皮件',
    })

    expect(result.success).toBe(true)
  })
})
