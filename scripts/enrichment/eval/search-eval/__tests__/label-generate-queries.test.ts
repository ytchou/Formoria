import { describe, expect, it } from 'vitest'
import { catalogQueries } from '../label-generate-queries'

const products = [
  { brandSlug: 'marcia-studio', subcategory: 'handbags', nameEn: 'Canvas Tote Bag' },
  { brandSlug: 'marcia-studio', subcategory: 'handbags', nameEn: 'Leather Bag' },
]
const brands = [
  { slug: 'marcia-studio', name: '瑪西亞工坊', romanizedName: 'Marcia Studio' },
  { slug: 'unpublished', name: '未收錄品牌', romanizedName: null },
]

describe('catalog query generation', () => {
  it('draws brand names only from brands with published catalog products', () => {
    const queries = catalogQueries('brand', products, brands, 20)
    expect(queries.map(q => q.query)).toEqual(['Marcia Studio', '瑪西亞工坊'])
    expect(queries.every(q => q.queryType === 'brand_name')).toBe(true)
  })

  it('draws short product nouns and English terms from published products', () => {
    expect(catalogQueries('keyword', products, brands, 20).map(q => q.query)).toContain('手提包')
    expect(catalogQueries('english', products, brands, 20).map(q => q.query)).toContain('Canvas Tote Bag')
  })

  it('keeps distinct catalog names when their generated slugs collide', () => {
    const colliding = [
      { slug: 'amour-1', name: 'A.MOUR', romanizedName: null },
      { slug: 'amour-2', name: 'A MOUR', romanizedName: null },
    ]
    const names = catalogQueries('brand', [
      { brandSlug: 'amour-1', subcategory: 'handbags', nameEn: null },
      { brandSlug: 'amour-2', subcategory: 'handbags', nameEn: null },
    ], colliding, 20)
    expect(new Set(names.map(item => item.id)).size).toBe(2)
  })
})
