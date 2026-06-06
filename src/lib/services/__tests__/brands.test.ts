import { describe, it, expect } from 'vitest'
import { brandToDomain, brandToInsert } from '../brands'

// Minimal row shape matching Supabase SELECT output
function makeBrandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'brand-1',
    name: 'Test Brand',
    slug: 'test-brand',
    description: 'A test brand',
    logo_url: null,
    hero_image_url: null,
    status: 'approved',
    category: 'fashion',
    website_url: null,
    contact_email: null,
    founding_year: null,
    purchase_links: [],
    social_links: {},
    retail_locations: [],
    product_photos: [],
    product_highlights: [],
    tags: [],
    submitted_at: '2026-01-01T00:00:00Z',
    approved_at: '2026-01-02T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    brand_taxonomy: [],
    brand_owners: null,
    ...overrides,
  }
}

describe('brandToDomain — isVerified', () => {
  it('sets isVerified=true when brand_owners is a single object', () => {
    const row = makeBrandRow({ brand_owners: { user_id: 'user-abc' } })
    const brand = brandToDomain(row)
    expect(brand.isVerified).toBe(true)
  })

  it('sets isVerified=true when brand_owners has at least one entry', () => {
    const row = makeBrandRow({ brand_owners: [{ user_id: 'user-abc' }] })
    const brand = brandToDomain(row)
    expect(brand.isVerified).toBe(true)
  })

  it('sets isVerified=false when brand_owners is an empty array', () => {
    const row = makeBrandRow({ brand_owners: [] })
    const brand = brandToDomain(row)
    expect(brand.isVerified).toBe(false)
  })

  it('sets isVerified=false when brand_owners is null', () => {
    const row = makeBrandRow({ brand_owners: null })
    const brand = brandToDomain(row)
    expect(brand.isVerified).toBe(false)
  })
})

describe('brandToDomain — isDemo', () => {
  it('maps is_demo true to isDemo true', () => {
    const row = makeBrandRow({ is_demo: true })
    const brand = brandToDomain(row)
    expect(brand.isDemo).toBe(true)
  })

  it('maps is_demo false to isDemo false', () => {
    const row = makeBrandRow({ is_demo: false })
    const brand = brandToDomain(row)
    expect(brand.isDemo).toBe(false)
  })

  it('defaults isDemo to false when is_demo is missing', () => {
    const row = makeBrandRow()
    // makeBrandRow does not include is_demo
    const brand = brandToDomain(row)
    expect(brand.isDemo).toBe(false)
  })
})

describe('brandToDomain — MIT verification fields', () => {
  it('maps verified MIT status, timestamp, evidence, and convenience boolean', () => {
    const row = makeBrandRow({
      mit_status: 'verified',
      mit_verified_at: '2026-02-03T04:05:06Z',
      mit_evidence: {
        mit_smile_listed: true,
        mit_smile_cert: '01200024-02134',
      },
      brand_owners: null,
    })

    const brand = brandToDomain(row)

    expect(brand.mitStatus).toBe('verified')
    expect(brand.mitVerified).toBe(true)
    expect(brand.mitVerifiedAt).toBe('2026-02-03T04:05:06Z')
    expect(brand.mitEvidence?.mit_smile_cert).toBe('01200024-02134')
  })

  it('maps unverified MIT status to mitVerified=false', () => {
    const row = makeBrandRow({
      mit_status: 'unverified',
      brand_owners: null,
    })

    const brand = brandToDomain(row)

    expect(brand.mitStatus).toBe('unverified')
    expect(brand.mitVerified).toBe(false)
  })
})

describe('brandToInsert — isDemo', () => {
  it('maps isDemo true to is_demo true', () => {
    const result = brandToInsert({ isDemo: true })
    expect(result.is_demo).toBe(true)
  })

  it('does not include is_demo when isDemo is false', () => {
    const result = brandToInsert({ isDemo: false })
    expect(result).not.toHaveProperty('is_demo')
  })

  it('does not include is_demo when isDemo is undefined', () => {
    const result = brandToInsert({ name: 'Test' })
    expect(result).not.toHaveProperty('is_demo')
  })
})
