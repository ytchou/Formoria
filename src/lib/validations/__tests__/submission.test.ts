import { describe, expect, it } from 'vitest'
import {
  createOwnerSubmissionSchema,
  fullSubmissionSchema,
} from '../submission'

const sourceAttribution = 'found_online'

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

  it('does not include retailLocations', () => {
    const shape = Object.keys(fullSubmissionSchema.shape)
    expect(shape).not.toContain('retailLocations')
  })

  it('accepts optional social links as strings', () => {
    const ownerSchema = createOwnerSubmissionSchema()
    const data = {
      name: 'TestBrand',
      website: 'https://example.com',
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
})
