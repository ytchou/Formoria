import { describe, it, expect } from 'vitest'
import { validateSubmission } from './submission-rules'

describe('validateSubmission', () => {
  const validSubmission = {
    brandName: 'Test Brand Co.',
    websiteUrl: 'https://testbrand.com',
    submitterEmail: 'owner@testbrand.com',
    description: 'A wonderful Taiwanese brand making handmade goods for everyday life.',
  }

  it('returns valid for a complete submission', () => {
    const result = validateSubmission(validSubmission)
    expect(result.isValid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('returns brand_name_empty when brand name is missing', () => {
    const result = validateSubmission({ ...validSubmission, brandName: '' })
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('brand_name_empty')
  })

  it('returns brand_name_empty when brand name is whitespace only', () => {
    const result = validateSubmission({ ...validSubmission, brandName: '   ' })
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('brand_name_empty')
  })

  it('returns website_url_invalid for malformed URL', () => {
    const result = validateSubmission({ ...validSubmission, websiteUrl: 'not-a-url' })
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('website_url_invalid')
  })

  it('accepts null website_url (optional field)', () => {
    const result = validateSubmission({ ...validSubmission, websiteUrl: null })
    expect(result.isValid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('returns submitter_email_invalid for malformed email', () => {
    const result = validateSubmission({ ...validSubmission, submitterEmail: 'bad-email' })
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('submitter_email_invalid')
  })

  it('returns description_too_short for short description', () => {
    const result = validateSubmission({ ...validSubmission, description: 'Too short' })
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('description_too_short')
  })

  it('returns description_too_short for null description', () => {
    const result = validateSubmission({ ...validSubmission, description: null })
    expect(result.isValid).toBe(false)
    expect(result.errors).toContain('description_too_short')
  })

  it('collects multiple errors at once', () => {
    const result = validateSubmission({
      brandName: '',
      websiteUrl: 'bad',
      submitterEmail: 'bad',
      description: null,
    })
    expect(result.isValid).toBe(false)
    expect(result.errors).toHaveLength(4)
    expect(result.errors).toContain('brand_name_empty')
    expect(result.errors).toContain('website_url_invalid')
    expect(result.errors).toContain('submitter_email_invalid')
    expect(result.errors).toContain('description_too_short')
  })
})
