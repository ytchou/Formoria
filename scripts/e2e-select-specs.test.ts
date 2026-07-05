import { describe, it, expect } from 'vitest'
import { selectSpecs } from './e2e-select-specs.mjs'

const routeMap = {
  'src/app/[locale]/brands/[slug]': [
    'e2e/tests/brand-detail.spec.ts',
    'e2e/tests/brand-share.spec.ts',
  ],
  'src/app/[locale]/brands': [
    'e2e/tests/directory.spec.ts',
    'e2e/tests/directory-sort.spec.ts',
  ],
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
})
