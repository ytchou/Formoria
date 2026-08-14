/** e2e specs seed brands under this prefix; they must never reach a public count or listing. */
export const TEST_BRAND_NAME_PREFIX = '[E2E-TEST]'
export const TEST_BRAND_NAME_PATTERN = `${TEST_BRAND_NAME_PREFIX}%`

/**
 * Applies the test-brand exclusion to any brands query. Every public-facing
 * count/listing must go through this — the filter drifting between surfaces is
 * what made /about and /stats report one more brand than /brands.
 */
export function excludeTestBrands<Q extends { not(column: string, operator: string, value: string): Q }>(
  query: Q,
  nameColumn = 'name',
): Q {
  return query.not(nameColumn, 'like', TEST_BRAND_NAME_PATTERN)
}
