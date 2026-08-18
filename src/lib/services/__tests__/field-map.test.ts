import { describe, expect, it } from 'vitest'

import { toBrandRow } from '../_shared/field-map'

describe('toBrandRow subcategories_en derivation', () => {
  it('derives subcategories_en when mapping subcategories', () => {
    const row = toBrandRow({ subcategories: ['托特包', '手工燈籠'] })
    expect(row.subcategories).toEqual(['托特包', '手工燈籠'])
    expect(row.subcategories_en).toEqual(['Tote Bags', '手工燈籠'])
  })

  it('normalizes a caller-supplied subcategoriesEn instead of trusting it', () => {
    // DEV-1266: the admin review action validates EN subcategories for length only, so
    // a stale hand-edited array must not survive the write boundary.
    const row = toBrandRow({ subcategories: ['後背包'], subcategoriesEn: ['backpack'] })
    expect(row.subcategories).toEqual(['後背包'])
    expect(row.subcategories_en).toEqual(['Backpacks'])
  })

  it('keeps a novel subcategory supplied EN but Title Cases it', () => {
    const row = toBrandRow({
      subcategories: ['手工燈籠'],
      subcategoriesEn: ['handmade lantern'],
    })
    expect(row.subcategories_en).toEqual(['Handmade Lantern'])
  })

  it('still derives when subcategoriesEn is omitted', () => {
    const row = toBrandRow({ subcategories: ['托特包', '手工燈籠'] })
    expect(row.subcategories_en).toEqual(['Tote Bags', '手工燈籠'])
  })

  it('does not set subcategories_en when subcategories is absent', () => {
    const row = toBrandRow({ name: 'Test Brand', slug: 'test-brand' })
    expect(row.subcategories_en).toBeUndefined()
  })
})

describe('toBrandRow city mapping', () => {
  it('maps city field to city column', () => {
    const row = toBrandRow({
      name: 'Test Brand',
      slug: 'test-brand',
      description: null,
      heroImageUrl: null,
      status: 'approved',
      categorySlug: null,
      foundingYear: null,
      city: 'taipei',
      subcategories: [],
    })

    expect(row.city).toBe('taipei')
  })

  it('maps null city to null', () => {
    const row = toBrandRow({
      name: 'Test Brand',
      slug: 'test-brand',
      description: null,
      heroImageUrl: null,
      status: 'approved',
      categorySlug: null,
      foundingYear: null,
      city: null,
      subcategories: [],
    })

    expect(row.city).toBeNull()
  })
})

describe('toBrandRow localized copy mapping', () => {
  it('maps camelCase English description and blurb fields', () => {
    const row = toBrandRow({
      descriptionEn:
        'Niizo crafts durable bags in Taiwan from natural canvas and leather.',
      blurbEn: 'Taiwanese slow-fashion bags made from natural materials.',
    })

    expect(row.description_en).toBe(
      'Niizo crafts durable bags in Taiwan from natural canvas and leather.',
    )
    expect(row.blurb_en).toBe(
      'Taiwanese slow-fashion bags made from natural materials.',
    )
  })
})
