import type { Brand } from '@/lib/types'

/**
 * Pure filter function: given all brands and a set of active tag slugs,
 * returns only brands that have at least one matching tag.
 *
 * Used by BrandGrid for client-side filtering without full page reload.
 */
export function filterBrandsByTags(brands: Brand[], selectedSlugs: string[]): Brand[] {
  if (selectedSlugs.length === 0) return brands
  const slugSet = new Set(selectedSlugs)
  return brands.filter((brand) => brand.tags.some((tag) => slugSet.has(tag.slug)))
}

/**
 * Parses the ?tags= URL search param string into an array of slugs.
 * Handles empty strings, whitespace, and deduplication.
 */
export function parseTagSlugsFromParam(raw: string | null): string[] {
  if (!raw) return []
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
}

/**
 * Serializes an array of tag slugs to the ?tags= URL search param format.
 * Returns null when the array is empty (param should be removed).
 */
export function serializeTagSlugsToParam(slugs: string[]): string | null {
  const deduplicated = [...new Set(slugs.filter(Boolean))]
  return deduplicated.length > 0 ? deduplicated.join(',') : null
}
