import { describe, expect, it } from 'vitest'
import {
  CLUSTER_PATTERNS,
  classifyLandingPage,
  classifyQuery,
  normalizeQuery,
} from './segmentation'

describe('Search Console segmentation', () => {
  it('normalizes 臺灣 to 台灣, width, case and whitespace', () => {
    const withTraditionalVariant = normalizeQuery('臺灣 品牌')
    const withoutSpace = normalizeQuery('台灣品牌')
    const fullWidth = normalizeQuery('ＴＡＩＷＡＮ　brand')
    const classified = classifyQuery('  臺灣 品牌  ')

    expect(withTraditionalVariant.replaceAll(' ', '')).toBe(withoutSpace)
    expect(fullWidth).toBe('taiwan brand')
    expect(classified.raw).toBe('  臺灣 品牌  ')
    expect(classified.normalized).toBe('台灣 品牌')
  })

  it('classifies each of the seven clusters', () => {
    // Representatives are the REAL 品牌-suffixed keywords shipped in
    // content/seo/keyword-map.yaml, not bare stems. Bare stems (台灣 文創,
    // 台灣 手作, 台灣 包包) classify correctly under either ordering, which is
    // exactly how core-taiwan-brand shadowing three clusters stayed invisible.
    // Listed in CLUSTER_PATTERNS order so the reachability assertion below can
    // compare the two directly.
    const representatives = [
      ['Formoria', 'branded'],
      ['台灣文創品牌', 'cultural-creative'],
      ['台灣手作品牌', 'craft-handmade'],
      ['台灣 設計品牌', 'design'],
      ['台灣包包品牌', 'product-category'],
      ['台灣 品牌', 'core-taiwan-brand'],
      ['Taiwanese handmade brands', 'english'],
    ] as const

    for (const [query, cluster] of representatives) {
      expect(classifyQuery(query).cluster).toBe(cluster)
    }

    // Every cluster in the table must be reachable: a pattern that is always
    // shadowed by an earlier, more general one is dead configuration.
    expect(representatives.map(([, cluster]) => cluster)).toEqual(
      CLUSTER_PATTERNS.map(({ cluster }) => cluster),
    )
  })

  it('every cluster pattern is reachable by a realistic query', () => {
    // A second, independent reachability proof: for each pattern, a query drawn
    // from the shipped keyword map must actually land on THAT cluster and not on
    // an earlier, more general one.
    const realisticQueries: Record<string, readonly string[]> = {
      branded: ['formoria', 'formoria 台灣品牌'],
      'cultural-creative': ['台灣文創品牌', '台灣文化創意品牌'],
      'craft-handmade': ['台灣手作品牌', '台灣工藝品牌', '台灣職人品牌'],
      design: ['台灣設計品牌', '台灣原創品牌', '台灣獨立品牌'],
      'product-category': ['台灣包包品牌', '台灣家具品牌', '台灣飾品品牌'],
      'core-taiwan-brand': ['台灣品牌', '台灣品牌目錄', '台灣選物平台'],
      english: ['Taiwan brand directory', 'Taiwanese design brands'],
    }

    for (const { cluster } of CLUSTER_PATTERNS) {
      const queries = realisticQueries[cluster]
      expect(queries, `no realistic query provided for cluster "${cluster}"`).toBeTruthy()
      for (const query of queries ?? []) {
        expect(classifyQuery(query).cluster, `"${query}" should be ${cluster}`).toBe(cluster)
      }
    }
  })

  it('specific topic clusters win over the core-taiwan-brand catch-all', () => {
    // The exact regressions: every one of these classified as core-taiwan-brand
    // before the ordering fix, making three clusters unreachable.
    expect(classifyQuery('台灣文創品牌').cluster).toBe('cultural-creative')
    expect(classifyQuery('台灣手作品牌').cluster).toBe('craft-handmade')
    expect(classifyQuery('台灣工藝品牌').cluster).toBe('craft-handmade')
    expect(classifyQuery('台灣包包品牌').cluster).toBe('product-category')
    expect(classifyQuery('台灣家具品牌').cluster).toBe('product-category')
  })

  it('classifies the map’s own English keywords', () => {
    // content/seo/keyword-map.yaml ships these as locale: en primary keywords.
    // "Taiwan brand directory" has no "taiwanese" in it and used to fall through
    // to unclassified.
    expect(classifyQuery('Taiwan brand directory').cluster).toBe('english')
    expect(classifyQuery('Taiwanese brands').cluster).toBe('english')
    expect(classifyQuery('Taiwanese craft brands').cluster).toBe('english')
    expect(classifyQuery('Taiwanese design brands').cluster).toBe('english')
  })

  it('cluster patterns are defined over normalized input', () => {
    // normalizeQuery owns the 臺→台 fold, so the patterns carry only 台灣. A
    // caller testing CLUSTER_PATTERNS against raw text must normalize first.
    const rawTraditional = '臺灣文創品牌'
    const corePattern = CLUSTER_PATTERNS.find(({ cluster }) => cluster === 'core-taiwan-brand')

    expect(CLUSTER_PATTERNS.some(({ pattern }) => pattern.test(rawTraditional))).toBe(false)
    expect(corePattern?.pattern.source).not.toContain('臺')
    expect(classifyQuery(rawTraditional).cluster).toBe('cultural-creative')
  })

  it('branded wins when a query matches both branded and another cluster', () => {
    expect(classifyQuery('formoria 台灣品牌').cluster).toBe('branded')
  })

  it('returns an unclassified marker rather than guessing', () => {
    expect(classifyQuery('天氣預報').cluster).toBe('unclassified')
  })

  it('classifies landing pages by type', () => {
    const pages = [
      ['/', 'homepage'],
      ['/brands', 'directory'],
      ['/brands?category=home', 'l1-category'],
      ['/brands/some-slug', 'brand-detail'],
      ['/stories/x', 'story'],
      ['/glossary', 'glossary'],
      ['/stats', 'stats'],
      ['/events/x', 'event'],
    ] as const

    for (const [url, pageType] of pages) {
      expect(classifyLandingPage(url).pageType).toBe(pageType)
    }
  })

  it('treats /en variants as the same page type', () => {
    expect(classifyLandingPage('/en/brands').pageType).toBe('directory')
  })

  it('ignores non-indexable query params when classifying', () => {
    expect(classifyLandingPage('/brands?category=home&page=2&sort=name').pageType).toBe(
      'l1-category',
    )
  })

  it('reads the L2 filter from `sub`, the param the app actually emits', () => {
    // brand-filter-sidebar.tsx writes { sub: ... }, directory-filter-url.ts types
    // the key as 'sub', brands/page.tsx reads 'sub'. `subcategory=` has zero hits
    // in src/ and e2e/, so it is NOT accepted as an alias.
    expect(classifyLandingPage('/brands?category=home&sub=lighting').pageType).toBe('l2-category')
    expect(classifyLandingPage('/en/brands?category=home&sub=lighting').pageType).toBe(
      'l2-category',
    )
    expect(classifyLandingPage('/brands?category=home&subcategory=lighting').pageType).toBe(
      'l1-category',
    )
  })

  it('treats a bare `sub` with no category as the directory', () => {
    expect(classifyLandingPage('/brands?sub=lighting').pageType).toBe('directory')
    expect(classifyLandingPage('/brands?sub=lighting').canonicalPage).toBe('/brands')
  })

  it('treats a multi-value filter as a directory view, not a category page', () => {
    // `/brands?category=fashion,home` is a URL the sidebar itself produces via
    // join(','). The registry models exactly one row per ontology slug, so a
    // multi-select is a filter view rather than a canonical category page.
    expect(classifyLandingPage('/brands?category=home').pageType).toBe('l1-category')
    expect(classifyLandingPage('/brands?category=fashion,home').pageType).toBe('directory')
    expect(classifyLandingPage('/brands?category=fashion,home').canonicalPage).toBe('/brands')
    expect(classifyLandingPage('/brands?category=home&sub=lighting,storage').pageType).toBe(
      'directory',
    )
    // Repeated keys are the same thing by another spelling.
    expect(classifyLandingPage('/brands?category=fashion&category=home').pageType).toBe('directory')
  })

  it('collapses locale and ranking params onto one canonicalPage', () => {
    const variants = [
      '/brands?category=bags',
      '/en/brands?category=bags',
      '/brands?category=bags&page=2',
      'https://formoria.tw/en/brands?category=bags&page=2',
      '/zh-TW/brands/?category=bags&sort=name&utm_source=newsletter',
    ]

    for (const variant of variants) {
      expect(classifyLandingPage(variant).canonicalPage, variant).toBe('/brands?category=bags')
    }

    expect(classifyLandingPage('/brands?category=bags&sub=totes').canonicalPage).toBe(
      '/brands?category=bags&sub=totes',
    )
    // Fixed order regardless of the order they appear in the URL.
    expect(classifyLandingPage('/brands?sub=totes&category=bags').canonicalPage).toBe(
      '/brands?category=bags&sub=totes',
    )
    expect(classifyLandingPage('/brands').canonicalPage).toBe('/brands')
    expect(classifyLandingPage('/').canonicalPage).toBe('/')
    expect(classifyLandingPage('/stories/x?category=bags').canonicalPage).toBe('/stories/x')
  })

  it('classifies the proposed /categories URL shape', () => {
    // Every l1-category and l2-category target_url in the committed map is under
    // /categories/... . The routes do not exist yet (Ticket B ratifies them), so
    // this branch fails silently rather than loudly if it is missing.
    expect(classifyLandingPage('/categories/bags-accessories').pageType).toBe('l1-category')
    expect(classifyLandingPage('/categories/bags-accessories/totes').pageType).toBe('l2-category')
    expect(classifyLandingPage('/en/categories/bags-accessories/').pageType).toBe('l1-category')
    expect(classifyLandingPage('/categories/bags-accessories/totes?page=2').canonicalPage).toBe(
      '/categories/bags-accessories/totes',
    )
    // Deeper than L2 is not a shape the map models.
    expect(classifyLandingPage('/categories/a/b/c').pageType).toBe('other/static')
  })
})
