import { describe, expect, it } from 'vitest'
import {
  classifyProductUrl,
  dedupeNearDuplicates,
  mergeCandidatePool,
  normalizeProductUrl,
  type ProductCandidate,
} from '../product-candidates'

// ---------------------------------------------------------------------------
// normalizeProductUrl
// ---------------------------------------------------------------------------

describe('normalizeProductUrl', () => {
  it('normalize_strips_tracking_and_keeps_product_params', () => {
    const raw =
      'https://Example.COM/products/cirrus-chair?product_id=249&sid=abc&goods_no=77&srsltid=x&utm_source=fb&fbclid=y&gclid=z&variant=blue'
    const result = normalizeProductUrl(raw)

    // Tracking params removed
    expect(result).not.toContain('srsltid')
    expect(result).not.toContain('utm_source')
    expect(result).not.toContain('fbclid')
    expect(result).not.toContain('gclid')
    expect(result).not.toContain('variant')

    // Product params kept
    expect(result).toContain('product_id=249')
    expect(result).toContain('sid=abc')
    expect(result).toContain('goods_no=77')

    // Host lowercased, path case preserved
    expect(result).toContain('example.com')
    expect(result).toContain('/products/cirrus-chair')

    // Trailing slash stripped
    expect(normalizeProductUrl('https://example.com/products/chair/')).toBe(
      'https://example.com/products/chair'
    )
  })

  it('returns null on unparseable input', () => {
    expect(normalizeProductUrl('')).toBeNull()
    expect(normalizeProductUrl('not a url')).toBeNull()
    expect(normalizeProductUrl('://broken')).toBeNull()
  })

  it('strips trailing slash from bare host', () => {
    expect(normalizeProductUrl('https://example.com/')).toBe(
      'https://example.com'
    )
  })
})

// ---------------------------------------------------------------------------
// classifyProductUrl
// ---------------------------------------------------------------------------

describe('classifyProductUrl', () => {
  it('classify_marks_product_detail', () => {
    expect(classifyProductUrl('https://a.com/products/cirrus-chair')).toBe(
      'product-detail'
    )
    expect(classifyProductUrl('https://a.com/product/b2305-02012/')).toBe(
      'product-detail'
    )
    expect(classifyProductUrl('https://a.com/item/foo')).toBe('product-detail')
    expect(classifyProductUrl('https://a.com/page?product_id=249')).toBe(
      'product-detail'
    )
  })

  it('classify_marks_listing_before_product', () => {
    // Bare /products (no slug after) is a listing, not product-detail
    expect(classifyProductUrl('https://a.com/products')).toBe('listing')
    expect(classifyProductUrl('https://a.com/products/')).toBe('listing')
    expect(classifyProductUrl('https://a.com/collections/chairs')).toBe(
      'listing'
    )
    expect(classifyProductUrl('https://a.com/shop')).toBe('listing')
    expect(classifyProductUrl('https://a.com/shop/')).toBe('listing')
  })

  it('does not classify /product-care as product-detail (segment-based)', () => {
    expect(classifyProductUrl('https://a.com/product-care')).toBe('other')
  })

  it('classifies other pages as other', () => {
    expect(classifyProductUrl('https://a.com/about')).toBe('other')
    expect(classifyProductUrl('https://a.com/contact')).toBe('other')
  })

  it('returns other for unparseable input', () => {
    expect(classifyProductUrl('')).toBe('other')
  })
})

// ---------------------------------------------------------------------------
// dedupeNearDuplicates
// ---------------------------------------------------------------------------

describe('dedupeNearDuplicates', () => {
  it('dedupe_collapses_colourways', () => {
    const candidates: ProductCandidate[] = [
      {
        url: 'https://a.com/products/chair?variant=blue',
        normalizedUrl: 'https://a.com/products/chair',
        title: 'Ergonomic Chair',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
      {
        url: 'https://a.com/products/chair?variant=red',
        normalizedUrl: 'https://a.com/products/chair',
        title: 'Ergonomic Chair',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
    ]
    const result = dedupeNearDuplicates(candidates)
    expect(result).toHaveLength(1)
  })

  it('dedupe_collapses_by_title_similarity', () => {
    const candidates: ProductCandidate[] = [
      {
        url: 'https://a.com/products/chair-blue',
        normalizedUrl: 'https://a.com/products/chair-blue',
        title: 'Ergonomic Office Chair - Midnight Blue',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
      {
        url: 'https://a.com/products/chair-red',
        normalizedUrl: 'https://a.com/products/chair-red',
        title: 'Ergonomic Office Chair - Sunset Red',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
    ]
    const result = dedupeNearDuplicates(candidates)
    expect(result).toHaveLength(1)
  })

  it('dedupe_keeps_distinct_products', () => {
    const candidates: ProductCandidate[] = [
      {
        url: 'https://a.com/products/chair',
        normalizedUrl: 'https://a.com/products/chair',
        title: 'Ergonomic Chair',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
      {
        url: 'https://a.com/products/desk',
        normalizedUrl: 'https://a.com/products/desk',
        title: 'Standing Desk',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
      {
        url: 'https://a.com/products/lamp',
        normalizedUrl: 'https://a.com/products/lamp',
        title: 'LED Desk Lamp',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
    ]
    const result = dedupeNearDuplicates(candidates)
    expect(result).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// mergeCandidatePool
// ---------------------------------------------------------------------------

describe('mergeCandidatePool', () => {
  it('rank_orders_by_search_position', () => {
    const candidates: ProductCandidate[] = [
      {
        url: 'https://a.com/products/lamp',
        normalizedUrl: 'https://a.com/products/lamp',
        title: 'Lamp',
        supplier: 'stored',
        urlClass: 'product-detail',
        searchPosition: 5,
      },
      {
        url: 'https://a.com/products/chair',
        normalizedUrl: 'https://a.com/products/chair',
        title: 'Chair',
        supplier: 'stored',
        urlClass: 'product-detail',
        searchPosition: 1,
      },
      {
        url: 'https://a.com/products/desk',
        normalizedUrl: 'https://a.com/products/desk',
        title: 'Desk',
        supplier: 'stored',
        urlClass: 'product-detail',
        searchPosition: 3,
      },
    ]
    const result = mergeCandidatePool(candidates)
    expect(result.products[0].title).toBe('Chair')
    expect(result.products[1].title).toBe('Desk')
    expect(result.products[2].title).toBe('Lamp')
  })

  it('separates products from listings and drops other', () => {
    const candidates: ProductCandidate[] = [
      {
        url: 'https://a.com/products/chair',
        normalizedUrl: 'https://a.com/products/chair',
        title: 'Chair',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
      {
        url: 'https://a.com/collections/furniture',
        normalizedUrl: 'https://a.com/collections/furniture',
        title: 'Furniture',
        supplier: 'scrape',
        urlClass: 'listing',
      },
      {
        url: 'https://a.com/about',
        normalizedUrl: 'https://a.com/about',
        title: 'About',
        supplier: 'scrape',
        urlClass: 'other',
      },
    ]
    const result = mergeCandidatePool(candidates)
    expect(result.products).toHaveLength(1)
    expect(result.listings).toHaveLength(1)
    // 'other' is dropped
    expect(
      [...result.products, ...result.listings].find(
        (c) => c.urlClass === 'other'
      )
    ).toBeUndefined()
  })
})
