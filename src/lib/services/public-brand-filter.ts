/** e2e specs seed brands under this prefix; they must never reach a public count or listing. */
export const TEST_BRAND_NAME_PATTERN = '[E2E-TEST]%'

/**
 * Applies the test-brand exclusion to any brands query. Every public-facing
 * count/listing must go through this — the filter drifting between surfaces is
 * what made /about and /stats report one more brand than /brands.
 */
export function excludeTestBrands<Q extends { not(column: string, operator: string, value: string): Q }>(
  query: Q,
): Q {
  return query.not('name', 'like', TEST_BRAND_NAME_PATTERN)
}
