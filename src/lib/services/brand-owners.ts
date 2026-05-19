import { createServiceClient } from '@/lib/supabase/server'

export type OwnedBrand = {
  brandId: string
  brandName: string
  brandSlug: string
  logoUrl: string | null
  claimedAt: string
}

export async function getUserBrands(userId: string): Promise<OwnedBrand[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_owners')
    .select('brand_id, claimed_at, brands(id, name, slug, logo_url)')
    .eq('user_id', userId)

  if (error) throw error

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((row: any) => ({
    brandId: row.brand_id,
    brandName: row.brands.name,
    brandSlug: row.brands.slug,
    logoUrl: row.brands.logo_url ?? null,
    claimedAt: row.claimed_at,
  }))
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export async function isOwnerOf(
  userId: string,
  brandId: string
): Promise<boolean> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_owners')
    .select('id')
    .eq('user_id', userId)
    .eq('brand_id', brandId)
    .maybeSingle()

  if (error) throw error
  return data !== null
}
