import { describe, it, expect } from 'vitest'
import {
  parseRemovedI18nStrings,
  selectChangedSpecs,
  selectSpecs,
  selectSpecsForRemovedStrings,
} from './e2e-select-specs.mjs'

const routeMap = {
  'src/app/[locale]/brands/[slug]': [
    'e2e/tests/brand-detail.spec.ts',
    'e2e/tests/brand-share.spec.ts',
  ],
  'src/app/[locale]/brands': [
    'e2e/tests/directory.spec.ts',
    'e2e/tests/directory-sort.spec.ts',
    'e2e/tests/search-edge-cases.spec.ts',
  ],
  'src/app/api/search': ['e2e/tests/search-edge-cases.spec.ts'],
  'src/components/brands/search-input.tsx': [
    'e2e/tests/search-edge-cases.spec.ts',
  ],
  'src/components/brands/search-suggestions.tsx': [
    'e2e/tests/search-edge-cases.spec.ts',
  ],
  'src/lib/services/brands.ts': ['e2e/tests/search-edge-cases.spec.ts'],
  'src/app/[locale]/submit': ['e2e/tests/community-submit.spec.ts'],
}

describe('selectSpecs', () => {
  it('returns specs for a direct route file change', () => {
    const result = selectSpecs(
      ['src/app/[locale]/brands/[slug]/page.tsx'],
      routeMap
    )
    expect(result).toContain('e2e/tests/brand-detail.spec.ts')
    expect(result).toContain('e2e/tests/brand-share.spec.ts')
  })

  it('prefix-matches nested paths under a route', () => {
    const result = selectSpecs(
      ['src/app/[locale]/brands/[slug]/components/Gallery.tsx'],
      routeMap
    )
    expect(result).toContain('e2e/tests/brand-detail.spec.ts')
  })

  it('does not match brands/page.tsx to brands/[slug] specs', () => {
    const result = selectSpecs(['src/app/[locale]/brands/page.tsx'], routeMap)
    expect(result).toContain('e2e/tests/directory.spec.ts')
    expect(result).not.toContain('e2e/tests/brand-detail.spec.ts')
  })

  it('returns empty array when no route matches', () => {
    expect(selectSpecs(['src/lib/utils.ts'], routeMap)).toEqual([])
  })

  it('deduplicates specs when multiple changed files match the same route', () => {
    const result = selectSpecs(
      [
        'src/app/[locale]/brands/[slug]/page.tsx',
        'src/app/[locale]/brands/[slug]/components/Foo.tsx',
      ],
      routeMap
    )
    const brandDetailCount = result.filter(
      s => s === 'e2e/tests/brand-detail.spec.ts'
    ).length
    expect(brandDetailCount).toBe(1)
  })

  it('aggregates specs from multiple matching routes', () => {
    const result = selectSpecs(
      [
        'src/app/[locale]/brands/[slug]/page.tsx',
        'src/app/[locale]/submit/page.tsx',
      ],
      routeMap
    )
    expect(result).toContain('e2e/tests/brand-detail.spec.ts')
    expect(result).toContain('e2e/tests/community-submit.spec.ts')
  })

  it.each([
    'src/app/api/search/route.ts',
    'src/components/brands/search-input.tsx',
    'src/components/brands/search-suggestions.tsx',
    'src/lib/services/brands.ts',
  ])('selects search coverage for %s', (changedFile) => {
    expect(selectSpecs([changedFile], routeMap)).toContain(
      'e2e/tests/search-edge-cases.spec.ts',
    )
  })
})

describe('selectChangedSpecs', () => {
  it('selects spec files that changed', () => {
    expect(
      selectChangedSpecs([
        'e2e/tests/seo.spec.ts',
        'src/app/[locale]/brands/page.tsx',
      ]),
    ).toEqual(['e2e/tests/seo.spec.ts'])
  })

  it('ignores non-spec files under e2e/', () => {
    expect(
      selectChangedSpecs(['e2e/fixtures/auth.ts', 'e2e/helpers/seed.ts']),
    ).toEqual([])
  })

  it('returns empty when nothing under e2e/ changed', () => {
    expect(selectChangedSpecs(['src/lib/utils.ts'])).toEqual([])
  })
})

describe('parseRemovedI18nStrings', () => {
  const diff = [
    '--- a/messages/en.json',
    '+++ b/messages/en.json',
    '@@ -12 +12 @@',
    '-    "title": "Formoria — Discover Taiwanese Brands",',
    '+    "title": "Brand Directory — Browse Taiwanese Brands | Formoria",',
  ].join('\n')

  it('captures removed values and ignores added ones', () => {
    expect(parseRemovedI18nStrings(diff)).toEqual([
      'Formoria — Discover Taiwanese Brands',
    ])
  })

  it('ignores the --- file header line', () => {
    expect(parseRemovedI18nStrings(diff)).not.toContain('a/messages/en.json')
  })

  it('skips values shorter than the grep threshold', () => {
    expect(parseRemovedI18nStrings('-    "close": "關閉",')).toEqual([])
  })

  it('decodes JSON escapes in removed values', () => {
    expect(parseRemovedI18nStrings('-    "note": "Line\\nbreak",')).toEqual([
      'Line\nbreak',
    ])
  })

  it('deduplicates a value removed from both locale files', () => {
    const twoFiles = [
      '-    "title": "Shared Copy Value",',
      '-    "heading": "Shared Copy Value",',
    ].join('\n')
    expect(parseRemovedI18nStrings(twoFiles)).toEqual(['Shared Copy Value'])
  })
})

describe('selectSpecsForRemovedStrings', () => {
  it('selects every spec referencing a removed string', () => {
    const index: Record<string, string[]> = {
      'Old Title': ['e2e/tests/seo.spec.ts', 'e2e/tests/directory.spec.ts'],
    }
    expect(
      selectSpecsForRemovedStrings(['Old Title'], (v: string) => index[v] ?? []),
    ).toEqual(['e2e/tests/seo.spec.ts', 'e2e/tests/directory.spec.ts'])
  })

  it('deduplicates specs matched by more than one removed string', () => {
    const result = selectSpecsForRemovedStrings(
      ['Old Title', 'Old Subtitle'],
      () => ['e2e/tests/seo.spec.ts'],
    )
    expect(result).toEqual(['e2e/tests/seo.spec.ts'])
  })

  it('returns empty when no spec references the removed strings', () => {
    expect(selectSpecsForRemovedStrings(['Old Title'], () => [])).toEqual([])
  })

  it('drops a generic token that matches more than five specs', () => {
    const many = Array.from({ length: 6 }, (_, i) => `e2e/tests/s${i}.spec.ts`)
    expect(selectSpecsForRemovedStrings(['owner'], () => many)).toEqual([])
  })

  it('keeps a string matching exactly the fan-out limit', () => {
    const five = Array.from({ length: 5 }, (_, i) => `e2e/tests/s${i}.spec.ts`)
    expect(selectSpecsForRemovedStrings(['Distinct Copy'], () => five)).toEqual(
      five,
    )
  })
})
