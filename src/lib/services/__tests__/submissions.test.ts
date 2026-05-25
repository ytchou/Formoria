import { describe, it, expect } from 'vitest'
import { buildSubmissionRecord } from '../submissions'

// Test the pure record-building logic without DB calls
describe('buildSubmissionRecord', () => {
  const base = {
    brandId: 'brand-123',
    brandName: 'Test Brand',
    submitterEmail: 'test@example.com',
    submitterName: 'Test User',
    description: 'Test description',
    websiteUrl: 'https://testbrand.com',
    socialLinks: {},
    suggestedTags: [],
    pdpaConsentAt: new Date().toISOString(),
    isOwner: false,
  }

  it('stores null logo_url when logoUrl is undefined', () => {
    const record = buildSubmissionRecord({ ...base, logoUrl: undefined })
    expect(record.logo_url).toBeNull()
  })

  it('stores valid logo_url when provided', () => {
    const record = buildSubmissionRecord({
      ...base,
      logoUrl: 'https://cdn.example.com/logo.png',
    })
    expect(record.logo_url).toBe('https://cdn.example.com/logo.png')
  })

  it('stores source_attribution when provided', () => {
    const record = buildSubmissionRecord({
      ...base,
      sourceAttribution: 'found_online',
    })
    expect(record.source_attribution).toBe('found_online')
  })

  it('stores null source_attribution when not provided', () => {
    const record = buildSubmissionRecord(base)
    expect(record.source_attribution).toBeNull()
  })

  it('stores is_brand_owner boolean', () => {
    const ownerRecord = buildSubmissionRecord({ ...base, isOwner: true })
    expect(ownerRecord.is_brand_owner).toBe(true)

    const communityRecord = buildSubmissionRecord({ ...base, isOwner: false })
    expect(communityRecord.is_brand_owner).toBe(false)
  })
})
