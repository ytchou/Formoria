import { createServiceClient } from '@/lib/supabase/server'
import type { SavedBrand } from '@/lib/types/saved-brand'

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
  return rows
    .filter((row) => row.brands?.status === 'approved')
    .map((row) => ({
      brandId: row.brand_id,
      brandName: row.brands!.name,
      brandSlug: row.brands!.slug,
      heroImageUrl: row.brands!.hero_image_url ?? null,
      savedAt: row.created_at,
    }))
}

export async function saveBrand(
  userId: string,
  brandId: string
): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('brand_saves').upsert(
    {
      user_id: userId,
      brand_id: brandId,
    },
    { onConflict: 'user_id,brand_id' }
  )

  if (error) throw error
}

export async function unsaveBrand(
  userId: string,
  brandId: string
): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('brand_saves')
    .delete()
    .eq('user_id', userId)
    .eq('brand_id', brandId)

  if (error) throw error
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
