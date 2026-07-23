import { describe, expect, it } from 'vitest'
import {
  createOwnerSubmissionSchema,
  createRecommendationSubmissionSchema,
  fullSubmissionSchema,
} from '../submission'

const sourceAttribution = 'found_online'

const validOwnerSubmission = {
  name: 'TestBrand',
  website: 'https://example.com',
  description: 'Taiwan-made home goods with practical daily designs.',
  heroImageUrl: 'https://example.com/hero.jpg',
  pdpaConsent: true,
  turnstileToken: 'test-token',
  honeypot: '',
}

describe('simplified submission schema', () => {
  it('accepts minimal recommendation with URL, name, source, PDPA, turnstile', () => {
    const data = {
      name: 'TestBrand',
      website: 'https://example.com',
      sourceAttribution,
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    }
    const result = fullSubmissionSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('does not require UBN field', () => {
    const data = {
      name: 'TestBrand',
      website: 'https://example.com',
      sourceAttribution,
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    }
    const result = fullSubmissionSchema.safeParse(data)
    expect(result.success).toBe(true)
    expect(fullSubmissionSchema.shape).not.toHaveProperty('unifiedBusinessNumber')
  })

  it('keeps description and hero image optional', () => {
    const shape = Object.keys(fullSubmissionSchema.shape)
    expect(shape).not.toContain('productType')
    expect(shape).not.toContain('productPhotos')
    expect(shape).toContain('description')
    expect(shape).toContain('heroImageUrl')
  })

  it('accepts optional social links as strings', () => {
    const ownerSchema = createOwnerSubmissionSchema()
    const data = {
      name: 'TestBrand',
      website: 'https://example.com',
      description: 'Taiwan-made home goods with practical daily designs.',
      heroImageUrl: 'https://example.com/hero.jpg',
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
      socialLinks: { instagram: 'https://instagram.com/test', threads: '', facebook: '' },
    }
    const result = ownerSchema.safeParse(data)
    expect(result.success).toBe(true)
  })

  it('requires sourceAttribution when isOwner is false', () => {
    const data = {
      name: 'TestBrand',
      website: 'https://example.com',
      isOwner: false,
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    }
    const result = fullSubmissionSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('requires an email only when newsletter consent is checked', () => {
    const schema = createRecommendationSubmissionSchema()
    const base = {
      name: 'TestBrand',
      website: 'https://example.com',
      sourceAttribution,
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    }

    expect(schema.safeParse({
      ...base,
      guestEmail: '',
      marketingEmailOptIn: false,
    }).success).toBe(true)
    expect(schema.safeParse({
      ...base,
      guestEmail: '',
      marketingEmailOptIn: true,
    }).success).toBe(false)
    expect(schema.safeParse({
      ...base,
      guestEmail: 'guest@example.com',
      marketingEmailOptIn: true,
    }).success).toBe(true)
  })

  it.each(['  ', '茶', '😀'])(
    'rejects a name with fewer than two visible characters: %j',
    (name) => {
      const result = createRecommendationSubmissionSchema().safeParse({
        name,
        website: 'https://example.com',
        sourceAttribution,
        pdpaConsent: true,
        turnstileToken: 'test-token',
        honeypot: '',
      })

      expect(result.success).toBe(false)
    },
  )

  it('accepts two emoji as two visible characters', () => {
    const result = createRecommendationSubmissionSchema().safeParse({
      name: '😀😀',
      website: 'https://example.com',
      sourceAttribution,
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(result.success).toBe(true)
  })

  it('trims names and HTTP URLs before returning parsed data', () => {
    const result = createRecommendationSubmissionSchema().parse({
      name: '  Test Brand  ',
      website: '  https://example.com/store  ',
      sourceAttribution,
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(result.name).toBe('Test Brand')
    expect(result.website).toBe('https://example.com/store')
  })

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1/private',
    'http://10.0.0.1',
    'http://172.16.0.1',
    'http://192.168.1.1',
    'http://169.254.1.1',
  ])('rejects a private website URL: %s', (website) => {
    const result = createRecommendationSubmissionSchema().safeParse({
      name: 'Test Brand',
      website,
      sourceAttribution,
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(result.success).toBe(false)
  })

  it('accepts a populated honeypot for silent bot handling', () => {
    const result = createRecommendationSubmissionSchema().safeParse({
      name: 'Test Brand',
      website: 'https://example.com',
      sourceAttribution,
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: 'bot-filled-this',
    })

    expect(result.success).toBe(true)
  })

  it('accepts a null optional recommendation image', () => {
    const result = createRecommendationSubmissionSchema().safeParse({
      name: 'Test Brand',
      website: 'https://example.com',
      heroImageUrl: null,
      sourceAttribution,
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    })

    expect(result.success).toBe(true)
  })
})

describe('owner submission romanizedName validation', () => {
  const ownerSchema = createOwnerSubmissionSchema()

  it('accepts submission without romanizedName', () => {
    const result = ownerSchema.safeParse(validOwnerSubmission)

    expect(result.success).toBe(true)
  })

  it('accepts valid romanizedName', () => {
    const result = ownerSchema.safeParse({
      ...validOwnerSubmission,
      romanizedName: 'Din Tai Fung',
    })

    expect(result.success).toBe(true)
  })

  it('rejects romanizedName with CJK characters', () => {
    const result = ownerSchema.safeParse({
      ...validOwnerSubmission,
      romanizedName: '鼎泰豐',
    })

    expect(result.success).toBe(false)
  })

  it('rejects romanizedName shorter than 2 chars', () => {
    const result = ownerSchema.safeParse({
      ...validOwnerSubmission,
      romanizedName: 'D',
    })

    expect(result.success).toBe(false)
  })

  it('still rejects a null required hero image', () => {
    const result = ownerSchema.safeParse({
      ...validOwnerSubmission,
      heroImageUrl: null,
    })

    expect(result.success).toBe(false)
  })
})
