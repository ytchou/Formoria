import { createServiceClient } from '@/lib/supabase/server'

export type BrandLikeState = {
  count: number
  liked: boolean
}

const VISITOR_HASH_PATTERN = /^[0-9a-f]{64}$/

async function requireApprovedBrand(
  supabase: ReturnType<typeof createServiceClient>,
  brandId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('brands')
    .select('id')
    .eq('id', brandId)
    .eq('status', 'approved')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Brand not found')
}

async function countBrandLikes(
  supabase: ReturnType<typeof createServiceClient>,
  brandId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('brand_likes')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)

  if (error) throw error
  return count ?? 0
}

export async function getBrandLikeState(
  brandId: string,
  visitorHash: string | null,
): Promise<BrandLikeState> {
  if (visitorHash && !VISITOR_HASH_PATTERN.test(visitorHash)) {
    throw new Error('Invalid visitor hash')
  }

  const supabase = createServiceClient()
  await requireApprovedBrand(supabase, brandId)

  const countPromise = countBrandLikes(supabase, brandId)
  const likedPromise = visitorHash
    ? supabase
        .from('brand_likes')
        .select('id')
        .eq('brand_id', brandId)
        .eq('visitor_hash', visitorHash)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null })

  const [count, { data, error }] = await Promise.all([countPromise, likedPromise])
  if (error) throw error

  return { count, liked: Boolean(data) }
}

export async function setBrandLike(
  brandId: string,
  visitorHash: string,
  liked: boolean,
): Promise<BrandLikeState> {
  if (!VISITOR_HASH_PATTERN.test(visitorHash)) throw new Error('Invalid visitor hash')

  const supabase = createServiceClient()
  await requireApprovedBrand(supabase, brandId)

  if (liked) {
    const { error } = await supabase.from('brand_likes').upsert(
      { brand_id: brandId, visitor_hash: visitorHash },
      { onConflict: 'brand_id,visitor_hash', ignoreDuplicates: true },
    )
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('brand_likes')
      .delete()
      .eq('brand_id', brandId)
      .eq('visitor_hash', visitorHash)
    if (error) throw error
  }

  return { count: await countBrandLikes(supabase, brandId), liked }
}
