import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadDatasetV2, resolveDataset } from '../dataset-v2'

// ---------------------------------------------------------------------------
// The homepage hero advertises example queries in its search placeholder.
// Each one must be a labelled golden query, so the examples we promise are
// the ones whose relevance we actually measure (DEV-1964).
// ---------------------------------------------------------------------------

const TEST_DIR = dirname(new URL(import.meta.url).pathname)
const MESSAGES_PATH = resolve(TEST_DIR, '../../../../../messages/zh-TW.json')

function heroExamples(): string[] {
  const messages = JSON.parse(readFileSync(MESSAGES_PATH, 'utf8')) as {
    landing: { hero: { searchPlaceholder: string } }
  }
  return messages.landing.hero.searchPlaceholder
    .replace(/^例：/, '')
    .split('、')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

describe('landing.hero.searchPlaceholder examples', () => {
  it('advertises at least one example', () => {
    expect(heroExamples().length).toBeGreaterThan(0)
  })

  it('every example is a query in the v3 golden dataset', () => {
    const goldenQueries = new Set(loadDatasetV2(resolveDataset('v3').path).map((item) => item.query))
    const missing = heroExamples().filter((example) => !goldenQueries.has(example))
    expect(missing).toEqual([])
  })
})
