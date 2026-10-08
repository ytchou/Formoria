import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadDatasetV2, resolveDataset } from '../dataset-v2'

// ---------------------------------------------------------------------------
// The homepage hero advertises example queries in its search placeholder.
// Each one must be a labelled golden query, so the examples we promise are
// the ones whose relevance we actually measure (DEV-1964; EN since DEV-1977).
// ---------------------------------------------------------------------------

const TEST_DIR = dirname(new URL(import.meta.url).pathname)
const MESSAGES_DIR = resolve(TEST_DIR, '../../../../../messages')

// Each locale's placeholder: a lead-in, then examples joined by a separator.
const LOCALES = [
  { locale: 'zh-TW', prefix: /^例：/, separator: '、' },
  { locale: 'en', prefix: /^Try:\s*/, separator: ',' },
] as const

function heroExamples(locale: string, prefix: RegExp, separator: string): string[] {
  const messages = JSON.parse(readFileSync(resolve(MESSAGES_DIR, `${locale}.json`), 'utf8')) as {
    landing: { hero: { searchPlaceholder: string } }
  }
  return messages.landing.hero.searchPlaceholder
    .replace(prefix, '')
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

describe.each(LOCALES)('landing.hero.searchPlaceholder examples ($locale)', ({ locale, prefix, separator }) => {
  it('advertises at least one example', () => {
    expect(heroExamples(locale, prefix, separator).length).toBeGreaterThan(0)
  })

  it('every example is a query in the v3 golden dataset', () => {
    const goldenQueries = new Set(loadDatasetV2(resolveDataset('v3').path).map((item) => item.query))
    const missing = heroExamples(locale, prefix, separator).filter((example) => !goldenQueries.has(example))
    expect(missing).toEqual([])
  })
})
