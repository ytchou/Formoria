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
    purchaseLinks: [],
    socialLinks: {},
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
  purchaseLinks: [{ platform: 'shopee', url: 'https://shopee', label: 'Shop' }],
  socialLinks: { instagram: 'https://ig/x' },
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
      'heroImage', 'logo', 'description', 'purchaseLinks', 'productPhotos',
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

  it('treats an empty socialLinks object as incomplete and any one link as complete', () => {
    expect(computeBrandCompleteness(makeBrand({ socialLinks: {} }))
      .items.find((i) => i.key === 'socialLinks')!.complete).toBe(false)
    expect(computeBrandCompleteness(makeBrand({ socialLinks: { threads: 'https://t/x' } }))
      .items.find((i) => i.key === 'socialLinks')!.complete).toBe(true)
  })

  it('treats empty arrays as incomplete', () => {
    const r = computeBrandCompleteness(makeBrand({ purchaseLinks: [], productPhotos: [], retailLocations: [] }))
    for (const k of ['purchaseLinks', 'productPhotos', 'retailLocations']) {
      expect(r.items.find((i) => i.key === k)!.complete).toBe(false)
    }
  })

  it('counts foundingYear 0 as present (non-null) but null as absent', () => {
    expect(computeBrandCompleteness(makeBrand({ foundingYear: 0 }))
      .items.find((i) => i.key === 'foundingYear')!.complete).toBe(true)
    expect(computeBrandCompleteness(makeBrand({ foundingYear: null }))
      .items.find((i) => i.key === 'foundingYear')!.complete).toBe(false)
  })
})
