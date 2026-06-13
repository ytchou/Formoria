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
    .order('claimed_at', { ascending: true })

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

export async function getBrandOwnerEmail(brandId: string): Promise<string | null> {
  const supabase = createServiceClient()
  const { data: owner, error } = await supabase
    .from('brand_owners')
    .select('user_id')
    .eq('brand_id', brandId)
    .maybeSingle()

  if (error) throw error
  if (!owner?.user_id) return null

  const { data, error: userError } = await supabase.auth.admin.getUserById(owner.user_id)
  if (userError) throw userError

  return data.user.email ?? null
}

export async function getBrandBySlugForAdmin(slug: string): Promise<OwnedBrand | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, slug, logo_url, brand_owners(claimed_at)')
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const owners = (data.brand_owners as unknown as { claimed_at: string }[] | undefined) ?? []

  return {
    brandId: data.id,
    brandName: data.name,
    brandSlug: data.slug,
    logoUrl: data.logo_url ?? null,
    claimedAt: owners[0]?.claimed_at ?? new Date().toISOString(),
  }
}
