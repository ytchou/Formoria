import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  buildReverseImportGraph,
  buildSelectionIndex,
  collectReachableImporters,
  collectSpecRoutes,
  extractImports,
  extractRoutes,
  isCodeFile,
  isRouteEntrypoint,
  isSelectableSpec,
  matchesRoute,
  parseRemovedI18nStrings,
  resolveImport,
  routePatternFor,
  selectChangedSpecs,
  selectDerivedSpecs,
  selectSpecsForRemovedStrings,
} from './e2e-select-specs.mjs'

describe('resolveImport', () => {
  const files = new Set([
    'src/components/button.tsx',
    'src/lib/format.ts',
    'src/lib/forms/index.ts',
    'src/app/page.tsx',
  ])
  const exists = (file: string) => files.has(file)

  it('resolves the repo alias, relative paths, extensions, and index files', () => {
    expect(resolveImport('src/app/page.tsx', '@/components/button', exists)).toBe(
      'src/components/button.tsx',
    )
    expect(resolveImport('src/app/page.tsx', '../lib/format', exists)).toBe(
      'src/lib/format.ts',
    )
    expect(resolveImport('src/app/page.tsx', '../lib/forms', exists)).toBe(
      'src/lib/forms/index.ts',
    )
  })

  it('returns null for bare, missing, and outside-repository imports', () => {
    expect(resolveImport('src/app/page.tsx', 'next/link', exists)).toBeNull()
    expect(resolveImport('src/app/page.tsx', './missing', exists)).toBeNull()
    expect(resolveImport('src/app/page.tsx', '../../../outside', exists)).toBeNull()
  })
})

describe('extractImports', () => {
  it('extracts static, side-effect, re-export, and dynamic imports', () => {
    const source = [
      "import Button from '@/components/button'",
      "import './globals.css'",
      "export { format } from '../lib/format'",
      "export * from '../lib/forms'",
      "const module = import('./lazy')",
    ].join('\n')

    expect(extractImports(source)).toEqual([
      '@/components/button',
      './globals.css',
      '../lib/format',
      '../lib/forms',
      './lazy',
    ])
  })
})

describe('buildReverseImportGraph', () => {
  it('maps each importee to its importers', () => {
    const files = new Set(['src/page.tsx', 'src/card.tsx', 'src/format.ts'])
    const sources = new Map([
      ['src/page.tsx', "import Card from './card'"],
      ['src/card.tsx', "export { format } from './format'"],
      ['src/format.ts', 'export const format = () => null'],
    ])

    expect(
      buildReverseImportGraph([...files], sources, (file: string) =>
        files.has(file),
      ),
    ).toEqual(
      new Map([
        ['src/card.tsx', new Set(['src/page.tsx'])],
        ['src/format.ts', new Set(['src/card.tsx'])],
      ]),
    )
  })
})

describe('collectReachableImporters', () => {
  it('uses breadth-first traversal to include transitive importers and the start file', () => {
    const graph = new Map([
      ['src/format.ts', new Set(['src/card.tsx'])],
      ['src/card.tsx', new Set(['src/app/page.tsx'])],
    ])

    expect(collectReachableImporters(['src/format.ts'], graph)).toEqual(
      new Set(['src/format.ts', 'src/card.tsx', 'src/app/page.tsx']),
    )
  })
})

describe('isRouteEntrypoint', () => {
  it.each([
    ['src/app/[locale]/brands/page.tsx', true],
    ['src/app/api/share-card/[slug]/route.tsx', true],
    ['src/app/layout.tsx', true],
    ['src/app/[locale]/brands/brand-list.tsx', false],
    ['src/app/robots.ts', false],
    ['src/components/brands/page-header.tsx', false],
  ])('classifies %s as %s', (file, expected) => {
    expect(isRouteEntrypoint(file)).toBe(expected)
  })
})

describe('isCodeFile', () => {
  it('accepts supported source extensions and rejects other tracked files', () => {
    expect(isCodeFile('src/app/page.tsx')).toBe(true)
    expect(isCodeFile('e2e/utils/navigation.js')).toBe(true)
    expect(isCodeFile('src/app/globals.css')).toBe(false)
  })
})

describe('isSelectableSpec', () => {
  it('accepts deep specs and rejects everything the deep project cannot run', () => {
    expect(isSelectableSpec('e2e/tests/directory.spec.ts')).toBe(true)
    // --project=deep matches e2e/tests/** only: a smoke path would filter
    // every test out of the project and fail the run.
    expect(isSelectableSpec('e2e/smoke/landing.spec.ts')).toBe(false)
    expect(isSelectableSpec('e2e/utils/submit-form.ts')).toBe(false)
  })
})

describe('routePatternFor', () => {
  it.each([
    ['src/app/[locale]/brands/[slug]/page.tsx', '/brands/[slug]'],
    ['src/app/[locale]/(protected)/dashboard/layout.tsx', '/dashboard'],
    ['src/app/(marketing)/about/template.tsx', '/about'],
    ['src/app/admin/brands/page.tsx', '/admin/brands'],
    ['src/app/api/search/route.ts', '/api/search'],
    ['src/app/page.tsx', '/'],
  ])('turns %s into %s', (entrypoint, pattern) => {
    expect(routePatternFor(entrypoint)).toBe(pattern)
  })
})

describe('extractRoutes', () => {
  it('extracts supported URL calls and normalizes query strings and locales', () => {
    const source = [
      "await page.goto('/brands?sort=name')",
      'await request.get("/en/brands")',
      'await request.post(`/admin/jobs/${jobId}/runlog`)',
      "await request.put('/api/brands/one')",
      "await request.delete('/api/brands/two')",
      "await fetch('/zh-TW/stats?period=week')",
    ].join('\n')

    expect(extractRoutes(source)).toEqual([
      '/brands',
      '/admin/jobs/*/runlog',
      '/api/brands/one',
      '/api/brands/two',
      '/stats',
    ])
  })

  it('drops the fragment so a section link matches its page', () => {
    // e2e/tests/faq.spec.ts visits '/faq#claim', served by /faq.
    expect(extractRoutes("await page.goto('/faq#claim')")).toEqual(['/faq'])
  })

  it('reads a URL argument written on its own line', () => {
    const source = [
      'const resp = await userPage.goto(',
      '  `/dashboard/brands/${brandSlug}/analytics`,',
      '  { timeout: 60_000 },',
      ')',
    ].join('\n')

    expect(extractRoutes(source)).toEqual(['/dashboard/brands/*/analytics'])
  })

  it('ignores non-literal and non-route first arguments', () => {
    expect(extractRoutes("page.goto(path)\nclient.get('brands')")).toEqual([])
  })
})

describe('matchesRoute', () => {
  it.each([
    ['/brands/acme', '/brands/[slug]', true],
    ['/brands/*', '/brands/[slug]', true],
    ['/admin/jobs/*/runlog', '/admin/jobs/[jobId]/runlog', true],
    ['/guides/design/history', '/guides/[...slug]', true],
    ['/guides/design', '/guides/[[...slug]]', true],
    ['/guides', '/guides/[...slug]', false],
    ['/brands/acme/edit', '/brands/[slug]', false],
    ['/brand/acme', '/brands/[slug]', false],
  ])('matches %s against %s as %s', (route, pattern, expected) => {
    expect(matchesRoute(route, pattern)).toBe(expected)
  })
})

describe('collectSpecRoutes', () => {
  it('includes routes from every transitively imported e2e helper', () => {
    const files = ['e2e/tests/submit.spec.ts', 'e2e/utils/form.ts', 'e2e/utils/nav.ts']
    const sources = new Map([
      ['e2e/tests/submit.spec.ts', "import { submit } from '../utils/form'"],
      ['e2e/utils/form.ts', "export { navigate } from './nav'"],
      ['e2e/utils/nav.ts', "page.goto('/submit/recommend')"],
    ])
    const fileSet = new Set(files)
    const graph = buildReverseImportGraph(files, sources, (file: string) =>
      fileSet.has(file),
    )

    expect(collectSpecRoutes(['e2e/tests/submit.spec.ts'], files, sources, graph)).toEqual(
      new Map([['e2e/tests/submit.spec.ts', new Set(['/submit/recommend'])]]),
    )
  })
})

// Regression tests against the real source tree, not a fixture. The map this
// mechanism replaced was 92% blind while its fixture-based tests were green,
// so these assert against files that actually exist in the repository.
describe('selectDerivedSpecs against the repository', () => {
  const trackedFiles = execFileSync('git', ['ls-files', 'src', 'e2e'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
  const trackedSet = new Set(trackedFiles)
  const files = trackedFiles.filter(isCodeFile)
  const sourceByFile = new Map(
    files.map(file => [file, readFileSync(file, 'utf8')] as const),
  )
  const selectionIndex = buildSelectionIndex(files, sourceByFile, (file: string) =>
    trackedSet.has(file),
  )
  const select = (changedFiles: string[]) =>
    selectDerivedSpecs(changedFiles, selectionIndex)

  it('selects dashboard coverage for a real dashboard component', () => {
    expect(select(['src/components/dashboard/dashboard-hero-card.tsx'])).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^e2e\/tests\/dashboard-.*\.spec\.ts$/),
      ]),
    )
  })

  it('selects dashboard coverage for the redesigned dashboard routes', () => {
    // The two commits that exposed the old map: both selected zero specs.
    expect(
      select([
        'src/app/[locale]/(protected)/dashboard/brands/[slug]/(dashboard)/page.tsx',
        'src/components/dashboard/dashboard-hero-card.tsx',
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^e2e\/tests\/dashboard-.*\.spec\.ts$/),
      ]),
    )
  })

  it('selects brands coverage for a real brands component', () => {
    expect(select(['src/components/brands/brand-header.tsx'])).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^e2e\/tests\/brand.*\.spec\.ts$/),
      ]),
    )
  })

  it('selects at least one spec for the brands service', () => {
    expect(select(['src/lib/services/brands.ts']).length).toBeGreaterThan(0)
  })

  it('selects nothing for a real file imported by no route', () => {
    expect(select(['src/lib/services/brands.test.ts'])).toEqual([])
  })

  it('never selects a spec the deep project cannot run', () => {
    // /getting-started is covered only by e2e/smoke: handing that path to
    // `--project=deep` would match no tests and fail the job.
    expect(select(['src/app/[locale]/getting-started/page.tsx'])).toEqual([])

    const everySpec = select(['src/components/ui/button.tsx'])
    expect(everySpec.length).toBeGreaterThan(0)
    expect(everySpec.every(isSelectableSpec)).toBe(true)
  })

  it('reaches a route through a helper the spec imports rather than a literal', () => {
    // submit-name-suggestion.spec.ts has no URL of its own — it navigates via
    // gotoSubmitRecommend() in e2e/utils/submit-form.ts.
    expect(select(['src/app/[locale]/submit/recommend/page.tsx'])).toContain(
      'e2e/tests/submit-name-suggestion.spec.ts',
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

  // `--project=deep` only matches `e2e/tests/**`. Passing it a smoke path
  // filters every test out of the project, and Playwright exits non-zero with
  // "no tests found" — a PR that touched only a smoke spec would red-wall.
  it('ignores smoke specs the deep project cannot run', () => {
    expect(
      selectChangedSpecs([
        'e2e/smoke/landing.spec.ts',
        'e2e/tests/seo.spec.ts',
      ]),
    ).toEqual(['e2e/tests/seo.spec.ts'])
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
