import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type BrandOwnerRow = Database['public']['Tables']['brand_owners']['Row']

/** Shape returned by: brand_owners.select('brand_id, claimed_at, brands(id, name, slug, logo_url)') */
type BrandOwnerRowWithBrand = Pick<BrandOwnerRow, 'brand_id' | 'claimed_at'> & {
  brands: {
    id: string
    name: string
    slug: string
    logo_url: string | null
  }
}

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

  // Cast to typed join shape — Supabase's select return type doesn't track the brands join
  const rows = (data ?? []) as unknown as BrandOwnerRowWithBrand[]
  return rows.map((row) => ({
    brandId: row.brand_id,
    brandName: row.brands.name,
    brandSlug: row.brands.slug,
    logoUrl: row.brands.logo_url ?? null,
    claimedAt: row.claimed_at,
  }))
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
