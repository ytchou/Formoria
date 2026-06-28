'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isOwnerOf } from '@/lib/services/brand-owners'
import { verifyMitByCert } from '@/lib/services/mit-verification'

export async function verifyMitAction(
  brandId: string,
  certNumber: string
): Promise<{ error: string } | undefined> {
  try {
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

    revalidatePath('/[locale]/brands/[slug]', 'page')
    revalidatePath('/dashboard')

    return undefined
  } catch (err) {
    console.error('[dashboard:verifyMit]', err)
    return { error: err instanceof Error ? err.message : 'An unexpected error occurred' }
  }
}
