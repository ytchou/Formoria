import type { TagCategory, TaxonomyTag } from '@/lib/types'
import type { TagSource } from '@/lib/types/taxonomy'
import { NotFoundError } from '@/lib/errors'
import { createServiceClient } from '@/lib/supabase/server'
import { generateSlug } from './brands'

// ---------------------------------------------------------------------------
// Additional types for taxonomy governance
// ---------------------------------------------------------------------------

export type UntaggedBrand = {
  id: string
  name: string
  slug: string
  category: string
}

export type BrandForReview = {
  id: string
  name: string
  slug: string
  tags: Array<TaxonomyTag & { source: TagSource }>
}

type ProcessSuggestedTagAction = 'create-new' | 'map-existing' | 'reject'

type NewTagData = {
  name: string
  nameZh?: string
  category: TagCategory
  brandId: string
}

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

export async function getTags(category?: TagCategory, includeInactive?: boolean): Promise<TaxonomyTag[]> {
  const supabase = createServiceClient()
  let query = supabase
    .from('taxonomy_tags')
    .select('*')

  if (!includeInactive) {
    query = query.eq('is_active', true)
  }

  if (category) {
    query = query.eq('category', category)
  }

  const { data, error } = await query

  if (error) throw error
  return (data ?? []).map(tagToDomain)
}

export async function getActiveCategories(): Promise<
  { slug: string; name: string; nameZh: string | null }[]
> {
  const supabase = createServiceClient()

  // Find product_type tags that have at least one approved brand
  const { data, error } = await supabase
    .from('taxonomy_tags')
    .select('*, brand_taxonomy!inner(brands!inner(status))')
    .eq('category', 'product_type')
    .eq('is_active', true)
    .eq('brand_taxonomy.brands.status', 'approved')

  if (error) throw error

  // Deduplicate by slug (multiple brands may produce repeated rows)
  const seen = new Set<string>()
  const result: { slug: string; name: string; nameZh: string | null }[] = []

  for (const row of data ?? []) {
    const tag = tagToDomain(row)
    if (!seen.has(tag.slug)) {
      seen.add(tag.slug)
      result.push({ slug: tag.slug, name: tag.name, nameZh: tag.nameZh })
    }
  }

  return result
}

export async function getValueTagsWithCoverage(minBrands = 1): Promise<TaxonomyTag[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('taxonomy_tags')
    .select('*, brand_taxonomy!inner(brands!inner(status))')
    .eq('category', 'value')
    .eq('is_active', true)
    .eq('brand_taxonomy.brands.status', 'approved')

  if (error) throw error

  // Count occurrences per tag (one row per brand_taxonomy join)
  const counts = new Map<string, { row: (typeof data)[0]; count: number }>()
  for (const row of data ?? []) {
    const existing = counts.get(row.id)
    if (existing) {
      existing.count++
    } else {
      counts.set(row.id, { row, count: 1 })
    }
  }

  return Array.from(counts.values())
    .filter(({ count }) => count >= minBrands)
    .map(({ row }) => tagToDomain(row))
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

export async function updateTag(
  id: string,
  data: { name?: string; nameZh?: string }
): Promise<TaxonomyTag> {
  const supabase = createServiceClient()
  const row: Record<string, unknown> = {}
  if (data.name !== undefined) {
    row.name = data.name
    row.slug = generateSlug(data.name)
  }
  if (data.nameZh !== undefined) {
    row.name_zh = data.nameZh
  }

  const { data: updated, error } = await supabase
    .from('taxonomy_tags')
    .update(row)
    .eq('id', id)
    .select('*')
    .single()

  if (error || !updated) throw new NotFoundError('TaxonomyTag', id)
  return tagToDomain(updated)
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
  const sourceBrandIds = (sourceRows ?? []).map((r) => r.brand_id)

  // Split into duplicates (already tagged with target) and reassignables
  const duplicateBrandIds = sourceBrandIds.filter((id) => targetBrandIds.has(id))
  const reassignBrandIds = sourceBrandIds.filter((id) => !targetBrandIds.has(id))

  // Batch delete duplicates
  if (duplicateBrandIds.length > 0) {
    const { error: delErr } = await supabase
      .from('brand_taxonomy')
      .delete()
      .in('brand_id', duplicateBrandIds)
      .eq('tag_id', sourceId)

    if (delErr) throw delErr
  }

  // Batch reassign non-duplicates to target
  if (reassignBrandIds.length > 0) {
    const { error: updateErr } = await supabase
      .from('brand_taxonomy')
      .update({ tag_id: targetId })
      .in('brand_id', reassignBrandIds)
      .eq('tag_id', sourceId)

    if (updateErr) throw updateErr
  }

  // Deactivate source tag
  const { error: deactivateErr } = await supabase
    .from('taxonomy_tags')
    .update({ is_active: false })
    .eq('id', sourceId)

  if (deactivateErr) throw deactivateErr
}

export async function deactivateTag(id: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('taxonomy_tags')
    .update({ is_active: false })
    .eq('id', id)

  if (error) throw error
}

export async function activateTag(id: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('taxonomy_tags')
    .update({ is_active: true })
    .eq('id', id)

  if (error) throw error
}

// ---------------------------------------------------------------------------
// Tag assignment CRUD
// ---------------------------------------------------------------------------

export async function setBrandTags(
  brandId: string,
  tagIds: string[],
  source: TagSource
): Promise<void> {
  const supabase = createServiceClient()

  // Fetch existing rows before delete so we can restore on insert failure
  const { data: existingRows, error: fetchErr } = await supabase
    .from('brand_taxonomy')
    .select('tag_id, source')
    .eq('brand_id', brandId)

  if (fetchErr) throw fetchErr

  const { error: deleteErr } = await supabase
    .from('brand_taxonomy')
    .delete()
    .eq('brand_id', brandId)

  if (deleteErr) throw deleteErr

  if (tagIds.length === 0) return

  const rows = tagIds.map((tagId) => ({ brand_id: brandId, tag_id: tagId, source }))
  const { error: insertErr } = await supabase.from('brand_taxonomy').insert(rows)

  if (insertErr) {
    // Best-effort restore of original rows to prevent permanent data loss
    if (existingRows && existingRows.length > 0) {
      const restoreRows = existingRows.map((r) => ({
        brand_id: brandId,
        tag_id: r.tag_id,
        source: r.source,
      }))
      const { error: restoreErr } = await supabase.from('brand_taxonomy').insert(restoreRows)
      if (restoreErr) {
        console.error('setBrandTags: failed to restore original tags after insert error', restoreErr)
      }
    }
    throw insertErr
  }
}

export async function addTagToBrand(
  brandId: string,
  tagId: string,
  source: TagSource
): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('brand_taxonomy')
    .upsert({ brand_id: brandId, tag_id: tagId, source }, { onConflict: 'brand_id,tag_id' })

  if (error) throw error
}

export async function removeTagFromBrand(brandId: string, tagId: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('brand_taxonomy')
    .delete()
    .eq('brand_id', brandId)
    .eq('tag_id', tagId)

  if (error) throw error
}

// ---------------------------------------------------------------------------
// Review queries
// ---------------------------------------------------------------------------

export async function getUntaggedBrands(): Promise<UntaggedBrand[]> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('brands')
    .select('id, name, slug, category, brand_taxonomy!left(brand_id)')
    .eq('status', 'approved')

  if (error) throw error

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? [])
    .filter((row: any) => !row.brand_taxonomy || row.brand_taxonomy.length === 0)
    .map((row: any) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      category: row.category,
    }))
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function getBrandsForReview(source: TagSource = 'auto'): Promise<BrandForReview[]> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('brands')
    .select('id, name, slug, brand_taxonomy!inner(source, taxonomy_tags(*))')
    .eq('brand_taxonomy.source', source)

  if (error) throw error

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    tags: (row.brand_taxonomy ?? []).map((bt: any) => ({
      ...tagToDomain(bt.taxonomy_tags),
      source: bt.source as TagSource,
    })),
  }))
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

// ---------------------------------------------------------------------------
// Suggested tag processing
// ---------------------------------------------------------------------------

export async function processSuggestedTag(
  submissionId: string,
  action: ProcessSuggestedTagAction,
  targetTagId?: string,
  newTagData?: NewTagData
): Promise<void> {
  if (action === 'reject') return

  if (action === 'map-existing') {
    if (!targetTagId) throw new Error('targetTagId required for map-existing action')
    await addTagToBrand(submissionId, targetTagId, 'suggested')
    return
  }

  if (action === 'create-new') {
    if (!newTagData) throw new Error('newTagData required for create-new action')
    const newTag = await createTag({
      name: newTagData.name,
      nameZh: newTagData.nameZh,
      category: newTagData.category,
      suggestedBy: submissionId,
    })
    await addTagToBrand(newTagData.brandId, newTag.id, 'suggested')
  }
}
