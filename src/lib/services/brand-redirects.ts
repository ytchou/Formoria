import { createServiceClient } from '@/lib/supabase/server'

export async function hasApprovedBrandSlug(slug: string): Promise<boolean> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brands')
    .select('id')
    .eq('slug', slug)
    .eq('status', 'approved')
    .maybeSingle()

  if (error) throw error

  return data !== null
}

export async function resolveApprovedBrandRedirect(oldSlug: string): Promise<string | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('brand_slug_redirects')
    .select('new_slug, brands!brand_slug_redirects_new_slug_fkey!inner(status)')
    .eq('old_slug', oldSlug)
    .eq('brands.status', 'approved')
    .maybeSingle()

  if (error) throw error

  return typeof data?.new_slug === 'string' ? data.new_slug : null
}
