import { createServiceClient } from '@/lib/supabase/service'
import { subcategoryDisplayLabel } from '@/lib/taxonomy/ontology'

const MAX_BRAND_ROWS = 500
const DEFAULT_SUGGESTION_LIMIT = 200

/**
 * The subcategory vocabulary offered to submitters and owners, drawn from what
 * approved brands already carry.
 *
 * The stored values are English slugs since DEV-1510; the field this feeds
 * offers zh-TW labels, so each value is resolved before it enters the list.
 * The list stays zh-TW in both locales, which is what it showed before the
 * storage swap — DEV-1510 Task 15 replaces the field with a closed picker.
 */
export async function getApprovedSubcategorySuggestions(
  limit = DEFAULT_SUGGESTION_LIMIT
): Promise<string[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select('subcategories')
    .eq('status', 'approved')
    .not('subcategories', 'is', null)
    .limit(MAX_BRAND_ROWS)

  if (error) throw error

  const suggestions = new Map<string, string>()
  for (const row of data ?? []) {
    if (!Array.isArray(row.subcategories)) continue
    for (const rawTag of row.subcategories) {
      if (typeof rawTag !== 'string') continue
      const stored = rawTag.trim().replace(/\s+/g, ' ')
      if (!stored) continue
      const tag = subcategoryDisplayLabel(stored, 'zh-TW')
      const normalized = tag.toLocaleLowerCase('en')
      if (!suggestions.has(normalized)) suggestions.set(normalized, tag)
    }
  }

  return [...suggestions.values()]
    .sort((left, right) => left.localeCompare(right, 'en'))
    .slice(0, Math.max(0, limit))
}
