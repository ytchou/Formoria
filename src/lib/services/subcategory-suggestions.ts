import { createServiceClient } from '@/lib/supabase/service'

const MAX_BRAND_ROWS = 500
const DEFAULT_SUGGESTION_LIMIT = 200

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
      const tag = rawTag.trim().replace(/\s+/g, ' ')
      if (!tag) continue
      const normalized = tag.toLocaleLowerCase('en')
      if (!suggestions.has(normalized)) suggestions.set(normalized, tag)
    }
  }

  return [...suggestions.values()]
    .sort((left, right) => left.localeCompare(right, 'en'))
    .slice(0, Math.max(0, limit))
}
