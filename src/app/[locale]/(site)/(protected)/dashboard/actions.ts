'use server'

import { runWithAuditContext } from '@/lib/audit/context'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireOwnerFeaturesEnabled } from '@/lib/auth/require-owner-features'
import { isOwnerOf } from '@/lib/services/brand-owners'
import { verifyMitByCert } from '@/lib/services/mit-verification'
import { getBrandById } from '@/lib/services/brands'
import { revalidatePublicBrands } from '@/lib/cache/public-brand-cache'

export async function verifyMitAction(
  brandId: string,
  certNumber: string
): Promise<{ error: string } | undefined> {
  return runWithAuditContext({}, async () => {
    try {
      if (!(await requireOwnerFeaturesEnabled())) {
        return { error: 'forbidden' }
      }

      const supabase = await createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        return { error: 'not_logged_in' }
      }

      const owner = await isOwnerOf(user.id, brandId)
      if (!owner) {
        return { error: 'forbidden' }
      }

      const result = await verifyMitByCert(brandId, certNumber)
      if (result.error) {
        return { error: result.error }
      }

      const brand = await getBrandById(brandId)
      revalidatePublicBrands([brand.slug])
      revalidatePath('/dashboard')

      return undefined
    } catch (err) {
      console.error('[dashboard:verifyMit]', err)
      return { error: err instanceof Error ? err.message : 'An unexpected error occurred' }
    }
  });
}
