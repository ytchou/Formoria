import { describe, it, expect } from 'vitest'
import { brandToDomain, brandToInsert } from '../brands'
import { pendingEditWithBrandToDomain } from '../pending-edits'

// Minimal row shape matching Supabase SELECT output
function makeBrandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'brand-1',
    name: 'Test Brand',
    slug: 'test-brand',
    description: 'A test brand',
    hero_image_url: null,
    status: 'approved' as const,
    category: 'fashion',
    website_url: null,
    contact_email: null,
    founding_year: null,
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
    purchase_website: null,
    purchase_pinkoi: null,
    purchase_shopee: null,
    other_urls: [],
    retail_locations: [],
    customer_voices: [],
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

describe('brandToDomain (flat link columns)', () => {
  it('maps social flat columns to domain fields', () => {
    const row = makeBrandRow({
      social_instagram: 'test_brand',
      social_threads: '@testbrand',
      social_facebook: 'https://facebook.com/testbrand',
    })
    const brand = brandToDomain(row)
    expect(brand.socialInstagram).toBe('test_brand')
    expect(brand.socialThreads).toBe('@testbrand')
    expect(brand.socialFacebook).toBe('https://facebook.com/testbrand')
  })

  it('maps purchase flat columns to domain fields', () => {
    const row = makeBrandRow({
      purchase_website: 'https://testbrand.com',
      purchase_pinkoi: 'https://pinkoi.com/store/testbrand',
      purchase_shopee: 'https://shopee.tw/testbrand',
    })
    const brand = brandToDomain(row)
    expect(brand.purchaseWebsite).toBe('https://testbrand.com')
    expect(brand.purchasePinkoi).toBe('https://pinkoi.com/store/testbrand')
    expect(brand.purchaseShopee).toBe('https://shopee.tw/testbrand')
  })

  it('maps other_urls JSONB to domain array', () => {
    const row = makeBrandRow({
      other_urls: [{ label: 'PChome', url: 'https://pchome.com/store' }],
    })
    const brand = brandToDomain(row)
    expect(brand.otherUrls).toEqual([{ label: 'PChome', url: 'https://pchome.com/store' }])
  })

  it('defaults null columns to null and empty array', () => {
    const row = makeBrandRow()
    const brand = brandToDomain(row)
    expect(brand.socialInstagram).toBeNull()
    expect(brand.purchaseWebsite).toBeNull()
    expect(brand.otherUrls).toEqual([])
  })
})

describe('brandToDomain — brand detail enrichment fields', () => {
  it('maps price_range to priceRange', () => {
    const row = makeBrandRow({ price_range: 3 })
    const brand = brandToDomain(row)
    expect(brand.priceRange).toBe(3)
  })

  it('maps product_tags to productTags', () => {
    const row = makeBrandRow({ product_tags: ['cotton', 'handmade'] })
    const brand = brandToDomain(row)
    expect(brand.productTags).toEqual(['cotton', 'handmade'])
  })

  it('defaults productTags to [] when product_tags is null', () => {
    const row = makeBrandRow({ product_tags: null })
    const brand = brandToDomain(row)
    expect(brand.productTags).toEqual([])
  })

  it('defaults priceRange to null when price_range is not set', () => {
    const row = makeBrandRow()
    const brand = brandToDomain(row)
    expect(brand.priceRange).toBeNull()
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

describe('brandToInsert (flat link columns)', () => {
  it('serializes flat link fields to snake_case columns', () => {
    const result = brandToInsert({
      socialInstagram: 'test_brand',
      socialThreads: null,
      socialFacebook: null,
      purchaseWebsite: 'https://testbrand.com',
      purchasePinkoi: null,
      purchaseShopee: null,
      otherUrls: [{ label: 'Blog', url: 'https://blog.test.com' }],
    })
    expect(result.social_instagram).toBe('test_brand')
    expect(result.social_threads).toBeNull()
    expect(result.purchase_website).toBe('https://testbrand.com')
    expect(result.other_urls).toEqual([{ label: 'Blog', url: 'https://blog.test.com' }])
  })
})

describe('brandToInsert — brand detail enrichment fields', () => {
  it('serializes priceRange to price_range', () => {
    const result = brandToInsert({ priceRange: 2 })
    expect(result.price_range).toBe(2)
  })

  it('serializes non-empty productTags to product_tags', () => {
    const result = brandToInsert({ productTags: ['minimal', 'gift'] })
    expect(result.product_tags).toEqual(['minimal', 'gift'])
  })

  it('serializes empty productTags as [] to allow clearing the field', () => {
    const result = brandToInsert({ productTags: [] })
    expect(result.product_tags).toEqual([])
  })
})

describe('pendingEditWithBrandToDomain (flat links)', () => {
  it('reconstructs brand with flat link fields from edit data', () => {
    const edit = pendingEditWithBrandToDomain({
      id: 'edit-1',
      brand_id: 'brand-1',
      submitted_by: 'user-1',
      proposed_data: {
        socialInstagram: 'proposed_ig',
        purchaseWebsite: 'https://proposed.example.com',
        otherUrls: [{ label: 'Blog', url: 'https://blog.example.com' }],
      },
      status: 'pending',
      brands: makeBrandRow({
        social_instagram: 'current_ig',
        social_threads: '@current',
        social_facebook: 'https://facebook.com/current',
        purchase_website: 'https://current.example.com',
        purchase_pinkoi: 'https://pinkoi.com/store/current',
        purchase_shopee: 'https://shopee.tw/current',
        other_urls: [{ label: 'Shop', url: 'https://shop.example.com' }],
      }),
    })

    expect(edit.brand.socialInstagram).toBe('proposed_ig')
    expect(edit.brand.socialThreads).toBe('@current')
    expect(edit.brand.socialFacebook).toBe('https://facebook.com/current')
    expect(edit.brand.purchaseWebsite).toBe('https://proposed.example.com')
    expect(edit.brand.purchasePinkoi).toBe('https://pinkoi.com/store/current')
    expect(edit.brand.purchaseShopee).toBe('https://shopee.tw/current')
    expect(edit.brand.otherUrls).toEqual([{ label: 'Blog', url: 'https://blog.example.com' }])
  })
})
