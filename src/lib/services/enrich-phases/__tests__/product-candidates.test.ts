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

  it('strips leading www. so www and bare host normalize to the same string', () => {
    expect(normalizeProductUrl('https://www.brand.tw/products/x')).toBe(
      normalizeProductUrl('https://brand.tw/products/x')
    )
    // The www. is actually removed, not just lowered
    expect(normalizeProductUrl('https://www.brand.tw/products/x')).toBe(
      'https://brand.tw/products/x'
    )
    // Uppercase WWW is also stripped
    expect(normalizeProductUrl('https://WWW.Brand.TW/products/x')).toBe(
      'https://brand.tw/products/x'
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
    // Case 1: two URLs differing only by variant (same normalizedUrl)
    const byUrl: ProductCandidate[] = [
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
    const { kept } = dedupeNearDuplicates(byUrl)
    expect(kept).toHaveLength(1)

    // Case 2: two titles differing only by a colour suffix but distinct URLs.
    // URL-distinctness override keeps both — distinct URLs = distinct products.
    const byTitle: ProductCandidate[] = [
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
    const { kept: kept2 } = dedupeNearDuplicates(byTitle)
    expect(kept2).toHaveLength(2)
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
    const { kept } = dedupeNearDuplicates(candidates)
    expect(kept).toHaveLength(3)
  })

  it('strips_cjk_fullwidth_dash_suffix', () => {
    const candidates: ProductCandidate[] = [
      {
        url: 'https://a.com/spray-classic',
        normalizedUrl: 'https://a.com/spray-classic',
        title: '薰香噴霧－經典花香',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
      {
        url: 'https://a.com/spray-green',
        normalizedUrl: 'https://a.com/spray-green',
        title: '薰香噴霧－清新綠茶',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
    ]
    // Distinct URLs but CJK fullwidth dash separates variant → still distinct
    // because URL-distinctness override fires first. To test the strip logic,
    // we need same normalizedUrl OR empty normalizedUrl. Use empty to bypass
    // URL-distinctness and exercise the title path.
    const withoutUrls: ProductCandidate[] = candidates.map((c) => ({
      ...c,
      normalizedUrl: '',
    }))
    const { kept } = dedupeNearDuplicates(withoutUrls)
    expect(kept).toHaveLength(1)
  })

  it('strips_cjk_fullwidth_pipe_suffix', () => {
    const candidates: ProductCandidate[] = [
      {
        url: 'https://a.com/stone-forest',
        normalizedUrl: '',
        title: '擴香石｜森林系列',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
      {
        url: 'https://a.com/stone-ocean',
        normalizedUrl: '',
        title: '擴香石｜海洋系列',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
    ]
    const { kept } = dedupeNearDuplicates(candidates)
    expect(kept).toHaveLength(1)
  })

  it('strips_cjk_bracket_suffix', () => {
    const candidates: ProductCandidate[] = [
      {
        url: 'https://a.com/spray-lavender',
        normalizedUrl: '',
        title: '室內噴霧【薰衣草】',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
      {
        url: 'https://a.com/spray-rose',
        normalizedUrl: '',
        title: '室內噴霧【玫瑰】',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
    ]
    const { kept } = dedupeNearDuplicates(candidates)
    expect(kept).toHaveLength(1)
  })

  it('preserves_title_without_separator', () => {
    const candidates: ProductCandidate[] = [
      {
        url: 'https://a.com/cup',
        normalizedUrl: 'https://a.com/cup',
        title: '純手工陶杯',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
    ]
    const { kept } = dedupeNearDuplicates(candidates)
    expect(kept).toHaveLength(1)
  })

  it('url_distinctness_keeps_similar_titles_room_spray', () => {
    const candidates: ProductCandidate[] = [
      {
        url: 'https://a.com/room-spray-35ml-essential-oil-ali-height',
        normalizedUrl:
          'https://a.com/room-spray-35ml-essential-oil-ali-height',
        title: '室內噴霧 35ml 精油 Ali Height',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
      {
        url: 'https://a.com/room-spray-35ml-essential-oil-ali-timeline',
        normalizedUrl:
          'https://a.com/room-spray-35ml-essential-oil-ali-timeline',
        title: '室內噴霧 35ml 精油 Ali Timeline',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
    ]
    const { kept } = dedupeNearDuplicates(candidates)
    expect(kept).toHaveLength(2)
  })

  it('collapse_count_reported', () => {
    const candidates: ProductCandidate[] = [
      {
        url: 'https://a.com/products/chair',
        normalizedUrl: 'https://a.com/products/chair',
        title: 'Chair',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
      {
        url: 'https://a.com/products/chair?variant=blue',
        normalizedUrl: 'https://a.com/products/chair',
        title: 'Chair Blue',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
      {
        url: 'https://a.com/products/desk',
        normalizedUrl: 'https://a.com/products/desk',
        title: 'Desk',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
      {
        url: 'https://a.com/products/desk?variant=oak',
        normalizedUrl: 'https://a.com/products/desk',
        title: 'Desk Oak',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
      {
        url: 'https://a.com/products/lamp',
        normalizedUrl: 'https://a.com/products/lamp',
        title: 'Lamp',
        supplier: 'scrape',
        urlClass: 'product-detail',
      },
    ]
    const { kept, collapsedCount } = dedupeNearDuplicates(candidates)
    expect(kept).toHaveLength(3)
    expect(collapsedCount).toBe(2)
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
