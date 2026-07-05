import { describe, expect, it } from 'vitest'

import { toBrandRow } from '../field-map'

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
