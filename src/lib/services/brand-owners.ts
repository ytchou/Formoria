import { imagePathToUrl } from '@/lib/images/image-url'
import { cache } from 'react'
import { auditedCall } from '@/lib/audit'
import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type BrandOwnerRow = Database['public']['Tables']['brand_owners']['Row']

/** Shape returned by: brand_owners.select('brand_id, claimed_at, brands(id, name, slug, hero_image_storage_path)') */
type BrandOwnerRowWithBrand = Pick<BrandOwnerRow, 'brand_id' | 'claimed_at'> & {
  brands: {
    id: string
    name: string
    slug: string
    hero_image_storage_path: string | null
  }
}

export type OwnedBrand = {
  brandId: string
  brandName: string
  brandSlug: string
  heroImageUrl: string | null
  claimedAt: string
}

export const getUserBrands = cache(async (userId: string): Promise<OwnedBrand[]> => {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_owners')
    .select('brand_id, claimed_at, brands(id, name, slug, hero_image_storage_path)')
    .eq('user_id', userId)
    .order('claimed_at', { ascending: true })

  if (error) throw error

  // Cast to typed join shape — Supabase's select return type doesn't track the brands join
  const rows = (data ?? []) as unknown as BrandOwnerRowWithBrand[]
  return rows.map((row) => ({
    brandId: row.brand_id,
    brandName: row.brands.name,
    brandSlug: row.brands.slug,
    heroImageUrl: imagePathToUrl(row.brands.hero_image_storage_path),
    claimedAt: row.claimed_at,
  }))
})

export const getUserBrand = cache(async (userId: string): Promise<OwnedBrand | null> => {
  const [brand] = await getUserBrands(userId)
  return brand ?? null
})

export async function getUserBrandByEmail(email: string): Promise<OwnedBrand | null> {
  const supabase = createServiceClient()
  const normalizedEmail = email.trim().toLowerCase()
  const perPage = 1000

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error

    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === normalizedEmail)
    if (user) return getUserBrand(user.id)
    if (data.users.length < perPage) return null
  }

  return null
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


/**
 * Every claimed owner of one brand.
 *
 * `isOwnerOf` answers "is THIS user an owner", which cannot classify a row
 * written by someone else. The public stockist provenance labels need the set:
 * an `owner_status = 'confirmed'` row renders
 * `brandDetail.channels.provenance.owner` only when the approver is in it, and
 * `...provenance.formoria` otherwise.
 *
 * This throws on a PostgREST error. `resolveBrandOwnerUserIds` in
 * `stockists.ts` is what converts that into `[]`, which degrades to the
 * humbler of the two labels rather than failing the whole brand page.
 */
export async function listBrandOwnerUserIds(brandId: string): Promise<string[]> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_owners')
    .select('user_id')
    .eq('brand_id', brandId)

  if (error) throw error
  return ((data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id)
}


export async function getBrandBySlugForAdmin(slug: string): Promise<OwnedBrand | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, slug, hero_image_storage_path, brand_owners(claimed_at)')
    .eq('slug', slug)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const owners = (data.brand_owners as unknown as { claimed_at: string }[] | undefined) ?? []

  return {
    brandId: data.id,
    brandName: data.name,
    brandSlug: data.slug,
    heroImageUrl: imagePathToUrl(data.hero_image_storage_path),
    claimedAt: owners[0]?.claimed_at ?? new Date().toISOString(),
  }
}

export async function revokeOwnership(
  brandId: string,
  revokedBy: string,
  reason: string
): Promise<{ userId: string; email: string }> {
  return auditedCall(
    { provider: 'claims', operation: 'revokeOwnership', kind: 'service' },
    async () => {
      const supabase = createServiceClient()
      const { data, error } = await supabase.rpc('revoke_brand_ownership', {
        p_brand_id: brandId,
        p_revoked_by: revokedBy,
        p_reason: reason,
      })

      if (error) throw error

      const [row] = data ?? []
      if (!row) throw new Error('Ownership revocation returned no owner')

      return {
        userId: row.revoked_user_id,
        email: row.revoked_user_email,
      }
    },
    { subjectId: brandId },
  )
}
