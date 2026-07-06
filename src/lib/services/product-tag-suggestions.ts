import { createServiceClient } from '@/lib/supabase/server'

const MAX_BRAND_ROWS = 500
const DEFAULT_SUGGESTION_LIMIT = 200

export async function getApprovedProductTagSuggestions(
  limit = DEFAULT_SUGGESTION_LIMIT
): Promise<string[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select('product_tags')
    .eq('status', 'approved')
    .not('product_tags', 'is', null)
    .limit(MAX_BRAND_ROWS)

  if (error) throw error

  const suggestions = new Map<string, string>()
  for (const row of data ?? []) {
    if (!Array.isArray(row.product_tags)) continue
    for (const rawTag of row.product_tags) {
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
