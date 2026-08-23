/**
 * Single source of truth for the three price-range tiers.
 * `labelKey` resolves against the `brandFields` i18n namespace.
 */
export const PRICE_RANGE_TIERS = [
  { value: 1, prefix: '$', labelKey: 'fieldPriceRangeBudget' },
  { value: 2, prefix: '$$', labelKey: 'fieldPriceRangeMidRange' },
  { value: 3, prefix: '$$$', labelKey: 'fieldPriceRangePremium' },
] as const

/** Bare `$` / `$$` / `$$$` for a known tier, `null` for anything else. */
export function formatPriceRange(value: unknown): string | null {
  return PRICE_RANGE_TIERS.find((tier) => tier.value === value)?.prefix ?? null
}

/**
 * Tier enrichment falls back to when the model reports no usable price signal.
 * A row without a price range fails the review completeness gate and can never
 * be published, so an unresolved price becomes mid-range rather than blocking
 * the brand. The model's raw `null` is still written to
 * `brand_ai_results.price_range`, so a defaulted tier stays distinguishable
 * from one the model actually determined.
 *
 * Least-wrong guess, not a measurement; upgrade path is a subcategory or
 * catalog-derived heuristic (DEV-995) once real product prices exist.
 */
export const DEFAULT_PRICE_RANGE = 2

/**
 * The tier enrichment should persist for a brand or submission: the model's
 * value when it is a known tier, `DEFAULT_PRICE_RANGE` otherwise. Also absorbs
 * out-of-range model output (0, 4, fractional), which would previously have
 * been written through unchecked.
 */
export function resolveEnrichedPriceRange(value: unknown): number {
  return PRICE_RANGE_TIERS.some((tier) => tier.value === value)
    ? (value as number)
    : DEFAULT_PRICE_RANGE
}
