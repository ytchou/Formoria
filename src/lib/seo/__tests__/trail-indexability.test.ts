import { describe, expect, it } from 'vitest'

import {
  MIN_TRAIL_PRODUCTS,
  trailIndexBlockers,
  type TrailIndexabilityFrontmatter,
  type TrailIndexabilityProduct,
} from '../trail-indexability'

const baseFrontmatter: TrailIndexabilityFrontmatter = {
  draft: false,
  promise: 'A useful promise',
  exclusions: 'Prices and stock are not covered.',
  editorialOwner: 'Formoria Editorial',
  reviewedAt: '2026-08-15T00:00:00.000Z',
  sections: [
    { key: 'first', title: 'First' },
    { key: 'second', title: 'Second' },
  ],
}

function product(
  l2: string,
  sectionKey = 'first',
): TrailIndexabilityProduct {
  return { l1: 'home', l2: [l2], sectionKey }
}

function products(count: number, l2 = 'lighting'): TrailIndexabilityProduct[] {
  return Array.from({ length: count }, (_, index) =>
    product(l2, index % 2 === 0 ? 'first' : 'second'),
  )
}

describe('trailIndexBlockers', () => {
  it('blocks a draft trail', () => {
    const blockers = trailIndexBlockers({
      frontmatter: { ...baseFrontmatter, draft: true },
      products: products(MIN_TRAIL_PRODUCTS, 'lighting').map((item) => ({
        ...item,
        l2: ['lighting', 'furniture'],
      })),
    })

    expect(blockers).toContain('draft')
  })

  it('blocks missing promise, exclusions, editorialOwner, or reviewedAt', () => {
    const blockers = trailIndexBlockers({
      frontmatter: {
        ...baseFrontmatter,
        promise: '',
        exclusions: undefined,
        editorialOwner: '',
        reviewedAt: undefined,
      },
      products: products(6, 'lighting').map((item, index) => ({
        ...item,
        l2: [index === 0 ? 'lighting' : 'furniture'],
      })),
    })

    expect(blockers).toEqual(
      expect.arrayContaining(['promise', 'exclusions', 'editorialOwner', 'reviewedAt']),
    )
  })

  it('blocks fewer than MIN_TRAIL_PRODUCTS', () => {
    const blockers = trailIndexBlockers({
      frontmatter: baseFrontmatter,
      products: products(MIN_TRAIL_PRODUCTS - 1, 'lighting').map((item, index) => ({
        ...item,
        l2: [index % 2 === 0 ? 'lighting' : 'furniture'],
      })),
    })

    expect(blockers).toContain('min_products')
  })

  it('blocks a declared section with zero products', () => {
    const blockers = trailIndexBlockers({
      frontmatter: baseFrontmatter,
      products: products(6, 'lighting').map((item) => ({ ...item, sectionKey: 'first' })),
    })

    expect(blockers).toContain('empty_section')
  })

  it('blocks single-L2 dominance', () => {
    const blockers = trailIndexBlockers({
      frontmatter: baseFrontmatter,
      products: [
        ...products(5, 'lighting'),
        ...products(4, 'furniture'),
      ],
    })

    expect(blockers).toContain('l2_dominance')
  })

  it('passes the real pilot shape', () => {
    const pilot = [
      ...products(4, 'lighting'),
      product('furniture'),
      product('home-decor'),
      product('storage'),
      product('home-decor', 'second'),
      product('tea-and-coffee-ware', 'second'),
    ]

    expect(trailIndexBlockers({ frontmatter: baseFrontmatter, products: pilot })).toEqual([])
  })

  it('blocks fewer than 2 distinct L2s', () => {
    const blockers = trailIndexBlockers({
      frontmatter: baseFrontmatter,
      products: products(6, 'lighting').map((item) => ({ ...item, l2: ['lighting'] })),
    })

    expect(blockers).toContain('distinct_l2')
  })

  it('rejects an L2 value absent from L2_SUBCATEGORIES', () => {
    const blockers = trailIndexBlockers({
      frontmatter: baseFrontmatter,
      products: products(6, 'not-a-real-subcategory').map((item, index) => ({
        ...item,
        l2: [index === 0 ? 'not-a-real-subcategory' : 'furniture'],
      })),
    })

    expect(blockers).toContain('invalid_l2')
  })
})
