/**
 * Single source of truth for the three price-range tiers.
 * `labelKey` resolves against the `dashboard.edit` i18n namespace.
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
