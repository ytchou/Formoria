import { describe, it, expect, vi } from 'vitest'
import { brandToDomain, brandToInsert, generateSlug, deleteBrand } from './brands'
import { RESERVED_ROUTES } from '@/middleware'

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  })),
}))

vi.mock('next/server', () => {
  const NextResponse = {
    next: vi.fn(() => ({
      cookies: { set: vi.fn() },
    })),
  }
  return { NextResponse }
})

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

describe('deleteBrand', () => {
  it('should be an exported async function', () => {
    expect(typeof deleteBrand).toBe('function')
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

describe('brandToDomain — founder and brandHighlights', () => {
  const baseRow = {
    id: 'test-id', name: 'Test Brand', slug: 'test-brand',
    description: 'A test brand', logo_url: null, hero_image_url: null,
    status: 'approved', category: 'Food & Beverage', founding_year: 2004,
    purchase_links: [], social_links: {}, retail_locations: [],
    product_photos: [], contact_email: null, brand_taxonomy: [],
    submitted_at: '2026-01-01T00:00:00Z', approved_at: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    founder: null, brand_highlights: null,
  }

  it('maps founder JSONB with snake_case to BrandFounder with camelCase', () => {
    const row = {
      ...baseRow,
      founder: {
        name: 'Zhao Wenhao', title: 'Founder',
        avatar_url: 'https://example.com/avatar.jpg',
        quote: '我希望每瓶產品都能訴說台灣土地的故事',
      },
    }
    const brand = brandToDomain(row)
    expect(brand.founder).toEqual({
      name: 'Zhao Wenhao', title: 'Founder',
      avatarUrl: 'https://example.com/avatar.jpg',
      quote: '我希望每瓶產品都能訴說台灣土地的故事',
    })
  })

  it('maps brand_highlights string to brandHighlights', () => {
    const row = { ...baseRow, brand_highlights: 'Handcrafted with Taiwanese cedar since 1992' }
    const brand = brandToDomain(row)
    expect(brand.brandHighlights).toBe('Handcrafted with Taiwanese cedar since 1992')
  })

  it('maps null brand_highlights to null', () => {
    const row = { ...baseRow, brand_highlights: null }
    const brand = brandToDomain(row)
    expect(brand.brandHighlights).toBeNull()
  })

  it('handles null founder gracefully', () => {
    const brand = brandToDomain(baseRow)
    expect(brand.founder).toBeNull()
  })

})

describe('brandToInsert — founder and brandHighlights', () => {
  it('maps founder and brandHighlights to snake_case DB columns', () => {
    const input = {
      founder: { name: 'Jane', title: 'CEO', avatarUrl: 'https://ex.com/a.jpg', quote: 'Hello' },
      brandHighlights: 'Eco-certified packaging',
    }
    const row = brandToInsert(input)
    expect(row.founder).toEqual({
      name: 'Jane', title: 'CEO', avatar_url: 'https://ex.com/a.jpg', quote: 'Hello',
    })
    expect(row.brand_highlights).toBe('Eco-certified packaging')
  })

  it('writes null brandHighlights to brand_highlights null', () => {
    const data = { brandHighlights: null }
    const row = brandToInsert(data)
    expect(row.brand_highlights).toBeNull()
  })
})

describe('brand slug validation against reserved routes', () => {
  it('RESERVED_ROUTES set is available and non-empty', () => {
    expect(RESERVED_ROUTES.size).toBeGreaterThan(0)
  })

  it('generateSlug can produce reserved slugs that must be caught', () => {
    const slug = generateSlug('Admin')
    expect(slug).toBe('admin')
    expect(RESERVED_ROUTES.has(slug)).toBe(true)
  })

  it('normal brand names do not collide with reserved routes', () => {
    const slug = generateSlug('Cha Zi Tang')
    expect(RESERVED_ROUTES.has(slug)).toBe(false)
  })

  it('isReservedSlug returns true for reserved slugs', async () => {
    const { isReservedSlug } = await import('./brands')
    expect(isReservedSlug('admin')).toBe(true)
    expect(isReservedSlug('api')).toBe(true)
    expect(isReservedSlug('cha-zi-tang')).toBe(false)
  })
})
