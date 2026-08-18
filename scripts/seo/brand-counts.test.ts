import { describe, it, expect } from 'vitest'
import { aggregateBrandCounts, isTestBrandName, type BrandCountRow } from './brand-counts'

function brand(
  category: string | null,
  subcategories: string[],
  overrides: Partial<BrandCountRow> = {},
): BrandCountRow {
  return {
    name: 'A Brand',
    category,
    subcategories,
    status: 'approved',
    ...overrides,
  }
}

describe('aggregateBrandCounts', () => {
  it('aggregates brand counts per L1 category', () => {
    const result = aggregateBrandCounts([
      brand('fashion', ['牛仔褲']),
      brand('fashion', ['裙裝']),
      brand('jewelry', ['手鍊']),
      brand(null, ['手鍊']),
      brand('not-a-category', ['手鍊']),
    ])

    expect(result.category_totals.fashion).toBe(2)
    expect(result.category_totals.jewelry).toBe(1)
    expect(result.category_totals).not.toHaveProperty('not-a-category')
    expect(result.category_totals).not.toHaveProperty('null')
  })

  it('resolves subcategories to ontology slugs within the brand category', () => {
    const result = aggregateBrandCounts([
      brand('fashion', ['牛仔褲', '褲裝']),
      brand('jewelry', ['手鍊', '手鍊手環']),
    ])

    expect(result.subcategories).toEqual([
      {
        slug: 'bracelets-and-bangles',
        nameZh: '手鍊・手環',
        nameEn: 'Bracelets & Bangles',
        category: 'jewelry',
        brand_count: 1,
        corpus_brand_count: 1,
        l1_branches: 1,
        isComposite: true,
      },
      {
        slug: 'pants',
        nameZh: '褲裝',
        nameEn: 'Pants',
        category: 'fashion',
        brand_count: 1,
        corpus_brand_count: 1,
        l1_branches: 1,
        isComposite: false,
      },
    ])
  })

  it('reports corpus_brand_count unscoped by category', () => {
    const result = aggregateBrandCounts([brand('beauty', ['家具'])])

    expect(result.subcategories).toEqual([
      {
        slug: 'furniture',
        nameZh: '家具',
        nameEn: 'Furniture',
        category: 'home',
        brand_count: 0,
        corpus_brand_count: 1,
        l1_branches: 1,
        isComposite: false,
      },
    ])
  })

  it('reports l1_branches as the number of distinct categorys carrying the tag', () => {
    const result = aggregateBrandCounts([
      brand('home', ['家具']),
      brand('beauty', ['家具']),
      brand('crafts', ['家具']),
    ])

    expect(result.subcategories).toEqual([
      expect.objectContaining({
        slug: 'furniture',
        brand_count: 1,
        corpus_brand_count: 3,
        l1_branches: 3,
      }),
    ])
  })

  it('does not count a tag whose subcategory belongs to another category', () => {
    // `/brands?category=jewelry` filters on category, so a fashion brand
    // tagged 手鍊 never renders on the jewelry subcategory page.
    const result = aggregateBrandCounts([brand('fashion', ['牛仔褲', '手鍊'])])

    expect(result.subcategories).toEqual([
      expect.objectContaining({
        slug: 'pants',
        category: 'fashion',
        brand_count: 1,
        corpus_brand_count: 1,
        l1_branches: 1,
      }),
      expect.objectContaining({
        slug: 'bracelets-and-bangles',
        category: 'jewelry',
        brand_count: 0,
        corpus_brand_count: 1,
        l1_branches: 1,
      }),
    ])
    // It resolves to a real subcategory, so it is not backlogged as unmatched either.
    expect(result.unmatched).toEqual([])
  })

  it('drops cross-category tags on rows with no recognised category', () => {
    const result = aggregateBrandCounts([
      brand(null, ['手鍊']),
      brand('not-a-category', ['手鍊']),
    ])

    expect(result.subcategories).toEqual([
      expect.objectContaining({
        slug: 'bracelets-and-bangles',
        brand_count: 0,
        corpus_brand_count: 2,
        l1_branches: 0,
      }),
    ])
  })

  it('collects unmatched tags separately', () => {
    const result = aggregateBrandCounts([
      brand('fashion', ['Custom Gizmo', 'custom gizmo', '未分類']),
      brand('fashion', ['CUSTOM GIZMO', '其他']),
    ])

    expect(result.unmatched).toEqual([
      { tag: 'Custom Gizmo', brand_count: 2 },
      { tag: '其他', brand_count: 1 },
      { tag: '未分類', brand_count: 1 },
    ])
  })

  it('excludes non-approved brands and e2e test brands, but counts demo brands', () => {
    const result = aggregateBrandCounts([
      brand('fashion', ['褲裝']),
      brand('fashion', ['裙裝'], { status: 'pending' }),
      // is_demo is intentionally not an exclusion: no public listing filters on it.
      brand('fashion', ['外套'], { name: 'Demo Brand' }),
      brand('jewelry', ['手鍊'], { status: null }),
      brand('fashion', ['裙裝'], { name: '[E2E-TEST] Seeded Brand' }),
    ])

    expect(result.category_totals.fashion).toBe(2)
    expect(result.category_totals.jewelry).toBe(0)
    expect(result.subcategories.map(({ slug }) => slug)).toEqual(['outerwear', 'pants'])
    expect(result.unmatched).toEqual([])
  })

  it('matches the public test-brand LIKE pattern', () => {
    expect(isTestBrandName('[E2E-TEST] Seeded Brand')).toBe(true)
    expect(isTestBrandName('[E2E-TEST]')).toBe(true)
    expect(isTestBrandName('Real [E2E-TEST] Brand')).toBe(false)
    expect(isTestBrandName('E2E-TEST Brand')).toBe(false)
    expect(isTestBrandName(null)).toBe(false)
  })

  it('buckets subcategories at 20, 15, 10 and 5', () => {
    const rows = [
      ...Array.from({ length: 20 }, () => brand('fashion', ['褲裝'])),
      ...Array.from({ length: 15 }, () => brand('bags-accessories', ['手提包'])),
      ...Array.from({ length: 10 }, () => brand('jewelry', ['手鍊'])),
      ...Array.from({ length: 5 }, () => brand('jewelry', ['項鍊'])),
    ]

    const result = aggregateBrandCounts(rows)

    expect(result.thresholds.at_least_20).toBe(1)
    expect(result.thresholds.at_least_15).toBe(2)
    expect(result.thresholds.at_least_10).toBe(3)
    expect(result.thresholds.at_least_5).toBe(4)
  })

  it('flags composite subcategory labels', () => {
    const result = aggregateBrandCounts([
      brand('jewelry', ['手鍊']),
      brand('fashion', ['牛仔褲']),
    ])

    expect(result.subcategories).toEqual([
      expect.objectContaining({ slug: 'bracelets-and-bangles', isComposite: true }),
      expect.objectContaining({ slug: 'pants', isComposite: false }),
    ])
  })
})
