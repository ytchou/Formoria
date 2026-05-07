import { describe, it, expect } from 'vitest'
import { brandToDomain, brandToInsert, generateSlug } from './brands'

describe('generateSlug', () => {
  it('converts name to kebab-case', () => {
    expect(generateSlug('My Cool Brand')).toBe('my-cool-brand')
  })

  it('strips special characters', () => {
    expect(generateSlug('Brand & Co. (Taiwan)')).toBe('brand-co-taiwan')
  })

  it('collapses multiple hyphens', () => {
    expect(generateSlug('Brand -- Name')).toBe('brand-name')
  })

  it('trims leading/trailing hyphens', () => {
    expect(generateSlug(' -Brand- ')).toBe('brand')
  })
})

describe('brandToDomain', () => {
  it('transforms snake_case DB row to camelCase Brand', () => {
    const dbRow = {
      id: '123',
      name: 'Test Brand',
      slug: 'test-brand',
      description: 'A test brand',
      logo_url: 'https://example.com/logo.png',
      hero_image_url: null,
      status: 'approved',
      category: 'food',
      founding_year: 2020,
      purchase_links: [{ platform: 'shopee', url: 'https://shopee.tw/test', label: 'Shopee' }],
      social_links: { instagram: '@test', official_website: 'https://test.com' },
      retail_locations: [],
      product_photos: ['photo1.jpg'],
      contact_email: 'test@example.com',
      submitted_at: '2026-01-01T00:00:00Z',
      approved_at: '2026-01-02T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      brand_taxonomy: [
        { taxonomy_tags: { id: 'tag1', name: 'Food', name_zh: '食品', slug: 'food', category: 'product_type', is_active: true, suggested_by: null, created_at: '2026-01-01T00:00:00Z' } }
      ],
    }

    const brand = brandToDomain(dbRow)

    expect(brand.id).toBe('123')
    expect(brand.logoUrl).toBe('https://example.com/logo.png')
    expect(brand.heroImageUrl).toBeNull()
    expect(brand.foundingYear).toBe(2020)
    expect(brand.purchaseLinks).toEqual([{ platform: 'shopee', url: 'https://shopee.tw/test', label: 'Shopee' }])
    expect(brand.socialLinks).toEqual({ instagram: '@test', officialWebsite: 'https://test.com' })
    expect(brand.productPhotos).toEqual(['photo1.jpg'])
    expect(brand.contactEmail).toBe('test@example.com')
    expect(brand.submittedAt).toBe('2026-01-01T00:00:00Z')
    expect(brand.approvedAt).toBe('2026-01-02T00:00:00Z')
    expect(brand.tags).toHaveLength(1)
    expect(brand.tags[0].name).toBe('Food')
    expect(brand.tags[0].nameZh).toBe('食品')
  })

  it('handles missing nested tags gracefully', () => {
    const dbRow = {
      id: '123', name: 'Test', slug: 'test', description: null,
      logo_url: null, hero_image_url: null, status: 'pending',
      category: null, founding_year: null, purchase_links: [],
      social_links: {}, retail_locations: [], product_photos: [],
      contact_email: null, submitted_at: '2026-01-01T00:00:00Z',
      approved_at: null, created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }

    const brand = brandToDomain(dbRow)
    expect(brand.tags).toEqual([])
  })
})

describe('brandToInsert', () => {
  it('transforms camelCase domain data to snake_case DB row', () => {
    const input = {
      name: 'New Brand',
      slug: 'new-brand',
      description: 'A new brand',
      logoUrl: 'https://example.com/logo.png',
      category: 'food',
      purchaseLinks: [{ platform: 'official', url: 'https://brand.com', label: 'Official' }],
      socialLinks: { instagram: '@brand', officialWebsite: 'https://brand.com' },
      contactEmail: 'brand@example.com',
    }

    const row = brandToInsert(input)

    expect(row.name).toBe('New Brand')
    expect(row.slug).toBe('new-brand')
    expect(row.logo_url).toBe('https://example.com/logo.png')
    expect(row.purchase_links).toEqual([{ platform: 'official', url: 'https://brand.com', label: 'Official' }])
    expect(row.social_links).toEqual({ instagram: '@brand', official_website: 'https://brand.com' })
    expect(row.contact_email).toBe('brand@example.com')
    expect(row).not.toHaveProperty('logoUrl')
    expect(row).not.toHaveProperty('purchaseLinks')
  })
})
