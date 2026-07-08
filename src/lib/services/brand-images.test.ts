import { describe, it, expect } from 'vitest'
import { toImageFields, pickHero } from './brand-images'

describe('toImageFields', () => {
  const rows = [
    { url: 'promo.jpg', status: 'rejected', sort_order: 0 },
    { url: 'prod.jpg', status: 'active', sort_order: 0 },
    { url: 'life.jpg', status: 'active', sort_order: 1 },
  ]

  it('maps active rows to the existing domain shape (hero + productPhotos + imageAlts)', () => {
    expect(toImageFields(rows as never)).toEqual({
      heroImageUrl: 'prod.jpg',
      productPhotos: ['life.jpg'],
      imageAlts: [
        { altZh: null, altEn: null },
        { altZh: null, altEn: null },
      ],
    })
  })
})

describe('pickHero', () => {
  it('prefers highest-scored product/lifestyle image', () => {
    const c = [
      { url: 'a', tags: ['lifestyle'], score: 70 },
      { url: 'b', tags: ['product'], score: 90 },
      { url: 'c', tags: ['promo'], score: 99 },
    ]
    expect(pickHero(c as never)!.url).toBe('b')
  })
})
