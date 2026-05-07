import type { TagCategory, TaxonomyTag } from '@/lib/types'
import { createServiceClient } from '@/lib/supabase/server'
import { generateSlug } from './brands'

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
export function tagToDomain(row: any): TaxonomyTag {
  return {
    id: row.id,
    name: row.name,
    nameZh: row.name_zh ?? null,
    slug: row.slug,
    category: row.category,
    isActive: row.is_active,
    suggestedBy: row.suggested_by ?? null,
    createdAt: row.created_at,
  }
}

export function tagToInsert(data: Partial<TaxonomyTag>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  if (data.name !== undefined) row.name = data.name
  if (data.nameZh !== undefined) row.name_zh = data.nameZh
  if (data.slug !== undefined) row.slug = data.slug
  if (data.category !== undefined) row.category = data.category
  if (data.isActive !== undefined) row.is_active = data.isActive
  if (data.suggestedBy !== undefined) row.suggested_by = data.suggestedBy
  return row
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function getTags(category?: TagCategory): Promise<TaxonomyTag[]> {
  const supabase = createServiceClient()
  let query = supabase
    .from('taxonomy_tags')
    .select('*')
    .eq('is_active', true)

  if (category) {
    query = query.eq('category', category)
  }

  const { data, error } = await query

  if (error) throw error
  return (data ?? []).map(tagToDomain)
}

export async function createTag(
  data: Pick<TaxonomyTag, 'name' | 'category'> & Partial<Pick<TaxonomyTag, 'nameZh' | 'suggestedBy'>>
): Promise<TaxonomyTag> {
  const supabase = createServiceClient()
  const slug = generateSlug(data.name)
  const row = tagToInsert({ ...data, slug })
  const { data: inserted, error } = await supabase
    .from('taxonomy_tags')
    .insert(row)
    .select('*')
    .single()

  if (error) throw error
  return tagToDomain(inserted)
}

export async function mergeTag(sourceId: string, targetId: string): Promise<void> {
  const supabase = createServiceClient()

  // Get all brand_taxonomy rows pointing to the source tag
  const { data: sourceRows, error: fetchErr } = await supabase
    .from('brand_taxonomy')
    .select('brand_id')
    .eq('tag_id', sourceId)

  if (fetchErr) throw fetchErr

  // Get existing brand_taxonomy rows for the target tag (to detect duplicates)
  const { data: targetRows, error: targetErr } = await supabase
    .from('brand_taxonomy')
    .select('brand_id')
    .eq('tag_id', targetId)

  if (targetErr) throw targetErr

  const targetBrandIds = new Set((targetRows ?? []).map((r) => r.brand_id))

  for (const row of sourceRows ?? []) {
    if (targetBrandIds.has(row.brand_id)) {
      // Duplicate: delete the source row
      await supabase
        .from('brand_taxonomy')
        .delete()
        .eq('brand_id', row.brand_id)
        .eq('tag_id', sourceId)
    } else {
      // Reassign to target
      await supabase
        .from('brand_taxonomy')
        .update({ tag_id: targetId })
        .eq('brand_id', row.brand_id)
        .eq('tag_id', sourceId)
    }
  }

  // Deactivate source tag
  await supabase
    .from('taxonomy_tags')
    .update({ is_active: false })
    .eq('id', sourceId)
}

export async function deactivateTag(id: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('taxonomy_tags')
    .update({ is_active: false })
    .eq('id', id)

  if (error) throw error
}
