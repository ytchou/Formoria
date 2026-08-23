import { describe, expect, it } from 'vitest'

import {
  DIRECTORY_FILTER_QUERY_KEYS,
  DIRECTORY_QUERY_KEYS,
  DIRECTORY_SEARCH_QUERY_KEY,
} from './directory-query-keys'
import { parseDirectoryViewFilters, type DirectorySearchParams } from './directory-filters'

/**
 * The drift guard for the canonical query vocabulary.
 *
 * `src/proxy.ts` and `src/lib/security/route-family.ts` now DERIVE their sets
 * from `directory-query-keys.ts`, so those two can no longer drift. The parser
 * cannot import the list -- it reads named properties -- so this test records
 * the properties it actually touches and compares them to the list.
 */
function recordReadKeys(): { keys: Set<string>; params: DirectorySearchParams } {
  const keys = new Set<string>()
  // `sub` is read only when exactly one VALID category is present, so the
  // recording run must supply one or the parser never touches that key.
  const values: Record<string, string> = { category: 'ceramics' }
  const params = new Proxy({} as Record<string, string | undefined>, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined
      keys.add(property)
      return values[property]
    },
  }) as DirectorySearchParams

  return { keys, params }
}

describe('directory query vocabulary', () => {
  it('lists exactly the keys parseDirectoryViewFilters reads', () => {
    const { keys, params } = recordReadKeys()
    parseDirectoryViewFilters(params, new Set(['ceramics']))

    expect([...keys].sort()).toEqual([...DIRECTORY_QUERY_KEYS].sort())
  })

  it('derives the filter list as the canonical list minus search', () => {
    expect(DIRECTORY_FILTER_QUERY_KEYS).not.toContain(DIRECTORY_SEARCH_QUERY_KEY)
    expect([...DIRECTORY_FILTER_QUERY_KEYS, DIRECTORY_SEARCH_QUERY_KEY].sort()).toEqual(
      [...DIRECTORY_QUERY_KEYS].sort(),
    )
  })
})
