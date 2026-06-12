'use server'

import { revalidatePath } from 'next/cache'
import { isBrandSaved, saveBrand, unsaveBrand } from '@/lib/services/saved-brands'
import { createClient } from '@/lib/supabase/server'

export async function toggleSaveAction(brandId: string) {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return { error: 'Not authenticated' }
  }

  const alreadySaved = await isBrandSaved(user.id, brandId)

  if (alreadySaved) {
    await unsaveBrand(user.id, brandId)
  } else {
    await saveBrand(user.id, brandId)
  }

  revalidatePath('/dashboard')

  return { ok: true as const, saved: !alreadySaved }
}
