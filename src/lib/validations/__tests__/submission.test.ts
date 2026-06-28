import { describe, expect, it } from 'vitest'
import { fullSubmissionSchema } from '../submission'

describe('simplified submission schema', () => {
  it('accepts minimal submission with URL, name, owner, PDPA, turnstile', () => {
    const data = {
      name: 'TestBrand',
      website: 'https://example.com',
      isOwner: true,
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
      isOwner: true,
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
    }
    const result = fullSubmissionSchema.safeParse(data)
    expect(result.success).toBe(true)
    expect(fullSubmissionSchema.shape).not.toHaveProperty('unifiedBusinessNumber')
  })

  it('does not require description, productType, productPhotos, heroImageUrl', () => {
    const shape = Object.keys(fullSubmissionSchema.shape)
    expect(shape).not.toContain('description')
    expect(shape).not.toContain('productType')
    expect(shape).not.toContain('productPhotos')
    expect(shape).not.toContain('heroImageUrl')
  })

  it('does not include retailLocations', () => {
    const shape = Object.keys(fullSubmissionSchema.shape)
    expect(shape).not.toContain('retailLocations')
  })

  it('accepts optional social links as strings', () => {
    const data = {
      name: 'TestBrand',
      website: 'https://example.com',
      isOwner: true,
      pdpaConsent: true,
      turnstileToken: 'test-token',
      honeypot: '',
      socialLinks: { instagram: 'https://instagram.com/test', threads: '', facebook: '' },
    }
    const result = fullSubmissionSchema.safeParse(data)
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
})
