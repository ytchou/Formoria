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
  // so it needs card image fields hydrated on its own. The full aligned fields
  // let favorites share the same object-first image choice as BrandCard.
  const hydrated = await hydrateCardImageMeta(
    supabase,
    approvedRows.map((row) => ({
      id: row.brands!.id,
      heroImageUrl: row.brands!.hero_image_url,
    })),
  )
  const imageFieldsByBrandId = new Map(
    hydrated.map((brand) => [brand.id, brand]),
  )

  return approvedRows.map((row) => {
    const imageFields = imageFieldsByBrandId.get(row.brands!.id)

    return {
      brandId: row.brand_id,
      brandName: row.brands!.name,
      brandSlug: row.brands!.slug,
      heroImageUrl: row.brands!.hero_image_url ?? null,
      productPhotos: imageFields?.productPhotos ?? [],
      imageAlts: imageFields?.imageAlts ?? [],
      savedAt: row.created_at,
      heroImageMeta: imageFields?.imageAlts.at(0) ?? null,
    }
  })
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
