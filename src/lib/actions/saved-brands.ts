'use server'

import { runWithAuditContext } from '@/lib/audit/context'
import {
  getUserSavedBrandIds,
  isBrandSaved,
  saveBrand,
  unsaveBrand,
} from '@/lib/services/saved-brands'
import { createClient } from '@/lib/supabase/server'

export async function getSavedBrandIdsAction() {
  return runWithAuditContext({}, async () => {
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return []
    }

    return getUserSavedBrandIds(user.id)
  });
}

export async function toggleSaveAction(brandId: string) {
  return runWithAuditContext({}, async () => {
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

    return { ok: true as const, saved: !alreadySaved }
  });
}
