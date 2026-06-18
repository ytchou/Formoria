import { describe, it, expect } from 'vitest'
import type { Brand } from '@/lib/types/brand'
import { computeBrandCompleteness } from '@/lib/services/brand-completeness'

// Minimal Brand builder — computeBrandCompleteness only reads the 9 scored fields.
function makeBrand(overrides: Partial<Brand> = {}): Brand {
  const base = {
    id: 'b1',
    slug: 'test-brand',
    name: 'Test Brand',
    description: null,
    logoUrl: null,
    heroImageUrl: null,
    foundingYear: null,
    socialInstagram: null,
    socialThreads: null,
    socialFacebook: null,
    purchaseWebsite: null,
    purchasePinkoi: null,
    purchaseShopee: null,
    otherUrls: [],
    retailLocations: [],
    productPhotos: [],
    brandHighlights: null,
  }
  return { ...base, ...overrides } as Brand
}

const EMPTY = makeBrand()
const FULL = makeBrand({
  description: 'A made-in-Taiwan brand',
  logoUrl: 'https://img/logo.png',
  heroImageUrl: 'https://img/hero.png',
  foundingYear: 2015,
  purchaseShopee: 'https://shopee',
  socialInstagram: 'https://ig/x',
  retailLocations: [{ name: 'Store', address: 'Taipei', latitude: 0, longitude: 0 }],
  productPhotos: ['https://img/p1.png'],
  brandHighlights: 'Handmade in Taiwan',
})

describe('computeBrandCompleteness', () => {
  it('scores an empty brand as 0 of 9', () => {
    const r = computeBrandCompleteness(EMPTY)
    expect(r.total).toBe(9)
    expect(r.completed).toBe(0)
    expect(r.fraction).toBe(0)
    expect(r.items).toHaveLength(9)
    expect(r.items.every((i) => !i.complete)).toBe(true)
  })

  it('scores a fully-filled brand as 9 of 9', () => {
    const r = computeBrandCompleteness(FULL)
    expect(r.completed).toBe(9)
    expect(r.fraction).toBe(1)
    expect(r.items.every((i) => i.complete)).toBe(true)
  })

  it('returns items in fixed impact-priority order with correct anchors', () => {
    const r = computeBrandCompleteness(EMPTY)
    expect(r.items.map((i) => i.key)).toEqual([
      'heroImage', 'description', 'logo', 'purchaseLinks', 'productPhotos',
      'socialLinks', 'brandHighlights', 'foundingYear', 'retailLocations',
    ])
    const anchorFor = (k: string) => r.items.find((i) => i.key === k)!.anchor
    expect(anchorFor('heroImage')).toBe('#media')
    expect(anchorFor('logo')).toBe('#media')
    expect(anchorFor('productPhotos')).toBe('#media')
    expect(anchorFor('description')).toBe('#description')
    expect(anchorFor('brandHighlights')).toBe('#brandHighlights')
    expect(anchorFor('foundingYear')).toBe('#foundingYear')
    expect(anchorFor('socialLinks')).toBe('#links')
    expect(anchorFor('purchaseLinks')).toBe('#links')
    expect(anchorFor('retailLocations')).toBe('#locations')
  })

  it('treats whitespace-only strings as incomplete', () => {
    const r = computeBrandCompleteness(makeBrand({ description: '   ', brandHighlights: '\n' }))
    expect(r.items.find((i) => i.key === 'description')!.complete).toBe(false)
    expect(r.items.find((i) => i.key === 'brandHighlights')!.complete).toBe(false)
  })

  it('treats empty arrays as incomplete', () => {
    const r = computeBrandCompleteness(makeBrand({ otherUrls: [], productPhotos: [], retailLocations: [] }))
    for (const k of ['productPhotos', 'retailLocations']) {
      expect(r.items.find((i) => i.key === k)!.complete).toBe(false)
    }
  })

  it('counts foundingYear 0 as present (non-null) but null as absent', () => {
    expect(computeBrandCompleteness(makeBrand({ foundingYear: 0 }))
      .items.find((i) => i.key === 'foundingYear')!.complete).toBe(true)
    expect(computeBrandCompleteness(makeBrand({ foundingYear: null }))
      .items.find((i) => i.key === 'foundingYear')!.complete).toBe(false)
  })

  describe('priority tiers', () => {
    it('returns items in visibility-first priority order', () => {
      const r = computeBrandCompleteness(EMPTY)
      expect(r.items.map((i) => i.key)).toEqual([
        'heroImage',
        'description',
        'logo',
        'purchaseLinks',
        'productPhotos',
        'socialLinks',
        'brandHighlights',
        'foundingYear',
        'retailLocations',
      ])
    })

    it('splits items into tier1 (high impact) and tier2 (good to have)', () => {
      const r = computeBrandCompleteness(EMPTY)
      expect(r.tier1Items).toHaveLength(5)
      expect(r.tier2Items).toHaveLength(4)
      expect(r.tier1Items.map((i) => i.key)).toEqual([
        'heroImage',
        'description',
        'logo',
        'purchaseLinks',
        'productPhotos',
      ])
      expect(r.tier2Items.map((i) => i.key)).toEqual([
        'socialLinks',
        'brandHighlights',
        'foundingYear',
        'retailLocations',
      ])
    })

    it('tier items reflect completion state', () => {
      const brand = makeBrand({
        heroImageUrl: 'https://img/hero.png',
        description: 'A brand',
        logoUrl: 'https://img/logo.png',
      })
      const r = computeBrandCompleteness(brand)
      expect(r.tier1Items.filter((i) => i.complete)).toHaveLength(3)
      expect(r.tier2Items.filter((i) => i.complete)).toHaveLength(0)
    })
  })

  describe('completeness with flat link fields', () => {
    it('socialLinks complete when any social field is non-empty', () => {
      const brand = makeBrand({ socialInstagram: 'test_brand' })
      const result = computeBrandCompleteness(brand)
      const socialItem = result.items.find((i) => i.key === 'socialLinks')
      expect(socialItem?.complete).toBe(true)
    })

    it('socialLinks incomplete when all social fields are null', () => {
      const brand = makeBrand()
      const result = computeBrandCompleteness(brand)
      const socialItem = result.items.find((i) => i.key === 'socialLinks')
      expect(socialItem?.complete).toBe(false)
    })

    it('purchaseLinks complete when any purchase field is non-empty', () => {
      const brand = makeBrand({ purchasePinkoi: 'https://pinkoi.com/store/test' })
      const result = computeBrandCompleteness(brand)
      const purchaseItem = result.items.find((i) => i.key === 'purchaseLinks')
      expect(purchaseItem?.complete).toBe(true)
    })

    it('purchaseLinks complete when otherUrls is non-empty', () => {
      const brand = makeBrand({
        otherUrls: [{ label: 'Blog', url: 'https://blog.test.com' }],
      })
      const result = computeBrandCompleteness(brand)
      const purchaseItem = result.items.find((i) => i.key === 'purchaseLinks')
      expect(purchaseItem?.complete).toBe(true)
    })

    it('purchaseLinks incomplete when all purchase fields and otherUrls are empty', () => {
      const brand = makeBrand()
      const result = computeBrandCompleteness(brand)
      const purchaseItem = result.items.find((i) => i.key === 'purchaseLinks')
      expect(purchaseItem?.complete).toBe(false)
    })
  })
})
