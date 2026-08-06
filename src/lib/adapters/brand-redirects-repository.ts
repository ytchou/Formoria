import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { BrandRedirectRepository } from '@/lib/services/brand-redirects-core'

export function createBrandRedirectRepository(
  supabase: SupabaseClient<Database>,
): BrandRedirectRepository {
  return {
    async hasApprovedBrandSlug(slug) {
      const { data, error } = await supabase
        .from('brands')
        .select('id')
        .eq('slug', slug)
        .eq('status', 'approved')
        .maybeSingle()

      if (error) throw error

      return data !== null
    },

    async resolveApprovedBrandRedirect(oldSlug) {
      const { data, error } = await supabase
        .from('brand_slug_redirects')
        .select('new_slug, brands!brand_slug_redirects_new_slug_fkey!inner(status)')
        .eq('old_slug', oldSlug)
        .eq('brands.status', 'approved')
        .maybeSingle()

      if (error) throw error

      return typeof data?.new_slug === 'string' ? data.new_slug : null
    },
  }
}
