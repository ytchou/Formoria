import { describe, expect, it } from 'vitest'

import { toBrandRow } from '../field-map'

describe('toBrandRow product_tags_en derivation', () => {
  it('derives product_tags_en when mapping productTags', () => {
    const row = toBrandRow({ productTags: ['托特包', '手工燈籠'] })
    expect(row.product_tags).toEqual(['托特包', '手工燈籠'])
    expect(row.product_tags_en).toEqual(['Tote Bags', '手工燈籠'])
  })

  it('uses explicit productTagsEn when provided', () => {
    const row = toBrandRow({ productTags: ['托特包'], productTagsEn: ['Custom Bags'] })
    expect(row.product_tags).toEqual(['托特包'])
    expect(row.product_tags_en).toEqual(['Custom Bags'])
  })

  it('does not set product_tags_en when productTags is absent', () => {
    const row = toBrandRow({ name: 'Test Brand', slug: 'test-brand' })
    expect(row.product_tags_en).toBeUndefined()
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
      category: null,
      foundingYear: null,
      city: 'taipei',
      productTags: [],
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
      category: null,
      foundingYear: null,
      city: null,
      productTags: [],
    })

    expect(row.city).toBeNull()
  })
})
