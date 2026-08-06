import { describe, it, expect } from 'vitest'
import { aggregateBrandCounts } from './brand-counts'

describe('aggregateBrandCounts', () => {
  it('aggregates brand counts per L1 product_type', () => {
    const result = aggregateBrandCounts([
      {
        product_type: 'fashion',
        product_tags: ['牛仔褲'],
        status: 'approved',
        is_demo: false,
      },
      {
        product_type: 'fashion',
        product_tags: ['裙裝'],
        status: 'approved',
        is_demo: null,
      },
      {
        product_type: 'jewelry',
        product_tags: ['手鍊'],
        status: 'approved',
        is_demo: false,
      },
      {
        product_type: null,
        product_tags: ['手鍊'],
        status: 'approved',
        is_demo: false,
      },
      {
        product_type: 'not-a-category',
        product_tags: ['手鍊'],
        status: 'approved',
        is_demo: false,
      },
    ])

    expect(result.product_type_totals.fashion).toBe(2)
    expect(result.product_type_totals.jewelry).toBe(1)
    expect(result.product_type_totals).not.toHaveProperty('not-a-category')
    expect(result.product_type_totals).not.toHaveProperty('null')
  })

  it('resolves product tags to ontology slugs', () => {
    const result = aggregateBrandCounts([
      {
        product_type: 'fashion',
        product_tags: ['牛仔褲', '褲裝', '手鍊', '手鍊手環'],
        status: 'approved',
        is_demo: false,
      },
    ])

    expect(result.subcategories).toEqual([
      {
        slug: 'bracelets-and-bangles',
        nameZh: '手鍊・手環',
        nameEn: 'Bracelets & Bangles',
        category: 'jewelry',
        brand_count: 1,
        isComposite: true,
      },
      {
        slug: 'pants',
        nameZh: '褲裝',
        nameEn: 'Pants',
        category: 'fashion',
        brand_count: 1,
        isComposite: false,
      },
    ])
  })

  it('collects unmatched tags separately', () => {
    const result = aggregateBrandCounts([
      {
        product_type: 'fashion',
        product_tags: ['Custom Gizmo', 'custom gizmo', '未分類'],
        status: 'approved',
        is_demo: false,
      },
      {
        product_type: 'fashion',
        product_tags: ['CUSTOM GIZMO', '其他'],
        status: 'approved',
        is_demo: false,
      },
    ])

    expect(result.unmatched).toEqual([
      { tag: 'Custom Gizmo', brand_count: 2 },
      { tag: '其他', brand_count: 1 },
      { tag: '未分類', brand_count: 1 },
    ])
  })

  it('excludes non-approved and demo brands', () => {
    const result = aggregateBrandCounts([
      {
        product_type: 'fashion',
        product_tags: ['褲裝'],
        status: 'approved',
        is_demo: null,
      },
      {
        product_type: 'fashion',
        product_tags: ['裙裝'],
        status: 'pending',
        is_demo: false,
      },
      {
        product_type: 'fashion',
        product_tags: ['外套'],
        status: 'approved',
        is_demo: true,
      },
      {
        product_type: 'jewelry',
        product_tags: ['手鍊'],
        status: null,
        is_demo: false,
      },
    ])

    expect(result.product_type_totals.fashion).toBe(1)
    expect(result.product_type_totals.jewelry).toBe(0)
    expect(result.subcategories.map(({ slug }) => slug)).toEqual(['pants'])
    expect(result.unmatched).toEqual([])
  })

  it('buckets subcategories at 20, 15, 10 and 5', () => {
    const rows = [
      ...Array.from({ length: 20 }, () => ({
        product_type: 'fashion',
        product_tags: ['褲裝'],
        status: 'approved',
        is_demo: false,
      })),
      ...Array.from({ length: 15 }, () => ({
        product_type: 'bags-accessories',
        product_tags: ['手提包'],
        status: 'approved',
        is_demo: false,
      })),
      ...Array.from({ length: 10 }, () => ({
        product_type: 'jewelry',
        product_tags: ['手鍊'],
        status: 'approved',
        is_demo: false,
      })),
      ...Array.from({ length: 5 }, () => ({
        product_type: 'jewelry',
        product_tags: ['項鍊'],
        status: 'approved',
        is_demo: false,
      })),
    ]

    const result = aggregateBrandCounts(rows)

    expect(result.thresholds.at_least_20).toBe(1)
    expect(result.thresholds.at_least_15).toBe(2)
    expect(result.thresholds.at_least_10).toBe(3)
    expect(result.thresholds.at_least_5).toBe(4)
  })

  it('flags composite subcategory labels', () => {
    const result = aggregateBrandCounts([
      {
        product_type: 'jewelry',
        product_tags: ['手鍊'],
        status: 'approved',
        is_demo: false,
      },
      {
        product_type: 'fashion',
        product_tags: ['牛仔褲'],
        status: 'approved',
        is_demo: false,
      },
    ])

    expect(result.subcategories).toEqual([
      expect.objectContaining({ slug: 'bracelets-and-bangles', isComposite: true }),
      expect.objectContaining({ slug: 'pants', isComposite: false }),
    ])
  })
})
