import { auditedCall } from '@/lib/audit'
import { createServiceClient } from '@/lib/supabase/service'
import type { SavedBrand } from '@/lib/types/saved-brand'
import { hydrateCardImageMeta } from '@/lib/services/brands'

type BrandSaveRow = {
  brand_id: string
}

type BrandSaveWithBrandRow = {
  brand_id: string
  created_at: string
  brands: {
    id: string
    name: string
    slug: string
    hero_image_url: string | null
    status: string
  } | null
}

export async function getUserSavedBrandIds(
  userId: string
): Promise<string[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_saves')
    .select('brand_id')
    .eq('user_id', userId)

  // PGRST205 = table not in PostgREST schema cache (migration pending or schema cache stale)
  if (error) {
    if (error.code === 'PGRST205') return []
    throw error
  }

  const rows = (data ?? []) as BrandSaveRow[]
  return rows.map((row) => row.brand_id)
}

export async function getUserSavedBrands(
  userId: string
): Promise<SavedBrand[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_saves')
    .select('brand_id, created_at, brands(id, name, slug, hero_image_url, status)')
    .eq('user_id', userId)

  if (error) {
    if (error.code === 'PGRST205') return []
    throw error
  }

  const rows = (data ?? []) as unknown as BrandSaveWithBrandRow[]
  const approvedRows = rows.filter((row) => row.brands?.status === 'approved')

  // This query reads `brands` directly rather than going through `getBrands`,
  // so it needs the hero's `brand_images` metadata hydrated on its own to know
  // which saved cards render a logo. Only `id` and `heroImageUrl` are required.
  const hydrated = await hydrateCardImageMeta(
    supabase,
    approvedRows.map((row) => ({
      id: row.brands!.id,
      heroImageUrl: row.brands!.hero_image_url,
    })),
  )
  // One map, one lookup per row: the fill mode and the object-position both
  // come from the same hero `BrandImageMeta`, so splitting them into two maps
  // meant two passes over `hydrated` reading the same `imageAlts.at(0)`.
  const heroMetaByBrandId = new Map(
    hydrated.map((brand) => [brand.id, brand.imageAlts.at(0) ?? null]),
  )

  return approvedRows.map((row) => ({
    brandId: row.brand_id,
    brandName: row.brands!.name,
    brandSlug: row.brands!.slug,
    heroImageUrl: row.brands!.hero_image_url ?? null,
    savedAt: row.created_at,
    heroImageMeta: heroMetaByBrandId.get(row.brands!.id) ?? null,
  }))
}

export async function saveBrand(
  userId: string,
  brandId: string
): Promise<void> {
  return auditedCall(
    { provider: 'brands', operation: 'saveBrand', kind: 'service' },
    async () => {
      const supabase = createServiceClient()
      const { error } = await supabase.from('brand_saves').upsert(
        {
          user_id: userId,
          brand_id: brandId,
        },
        { onConflict: 'user_id,brand_id' }
      )

      if (error) throw error
    },
    { subjectId: brandId, summary: { userId } },
  )
}

export async function unsaveBrand(
  userId: string,
  brandId: string
): Promise<void> {
  return auditedCall(
    { provider: 'brands', operation: 'unsaveBrand', kind: 'service' },
    async () => {
      const supabase = createServiceClient()
      const { error } = await supabase
        .from('brand_saves')
        .delete()
        .eq('user_id', userId)
        .eq('brand_id', brandId)

      if (error) throw error
    },
    { subjectId: brandId, summary: { userId } },
  )
}

export async function isBrandSaved(
  userId: string,
  brandId: string
): Promise<boolean> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_saves')
    .select('id')
    .eq('user_id', userId)
    .eq('brand_id', brandId)
    .maybeSingle()

  if (error) throw error
  return !!data
}
