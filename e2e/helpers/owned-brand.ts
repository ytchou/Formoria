import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

export async function ensureOwnedBrand(
  supabase: AnySupabaseClient,
  userId: string,
): Promise<{ id: string; slug: string; draftData: unknown }> {
  const findOwnedBrand = async () => {
    const { data: ownership } = await supabase
      .from('brand_owners')
      .select('brand_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (!ownership) return null

    const { data: brand, error } = await supabase
      .from('brands')
      .select('id, slug, draft_data')
      .eq('id', ownership.brand_id)
      .single()
    if (error || !brand) throw new Error(`Failed to load owned brand: ${error?.message}`)

    return { id: brand.id, slug: brand.slug, draftData: brand.draft_data }
  }

  const existing = await findOwnedBrand()
  if (existing) return existing

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data: created, error: createError } = await supabase
    .from('brands')
    .insert({
      name: `[E2E-TEST] Dashboard Brand ${suffix}`,
      slug: `e2e-dashboard-brand-${suffix}`,
      status: 'approved',
      product_type: 'crafts',
      description: 'Shared E2E dashboard fixture.',
      retail_locations: [],
    })
    .select('id, slug, draft_data')
    .single()
  if (createError || !created) throw new Error(`Failed to create owned brand: ${createError?.message}`)

  const { error: ownerError } = await supabase.from('brand_owners').insert({
    user_id: userId,
    brand_id: created.id,
  })

  if (!ownerError) {
    return { id: created.id, slug: created.slug, draftData: created.draft_data }
  }

  await supabase.from('brands').delete().eq('id', created.id)
  const racedOwner = await findOwnedBrand()
  if (racedOwner) return racedOwner

  throw new Error(`Failed to establish owned brand: ${ownerError.message}`)
}
