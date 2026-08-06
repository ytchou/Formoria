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
    // Listed in CLUSTER_PATTERNS order so the reachability assertion below can
    // compare the two directly.
    const representatives = [
      ['Formoria', 'branded'],
      ['台灣 設計品牌', 'design'],
      ['台灣 品牌', 'core-taiwan-brand'],
      ['台灣 文創', 'cultural-creative'],
      ['台灣 手作', 'craft-handmade'],
      ['台灣 包包', 'product-category'],
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
})
