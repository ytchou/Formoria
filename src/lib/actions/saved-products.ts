'use server'

import { runWithAuditContext } from '@/lib/audit/context'
import {
  getUserSavedProductIds,
  isProductSaved,
  saveProduct,
  unsaveProduct,
} from '@/lib/services/saved-products'
import { createClient } from '@/lib/supabase/server'

export async function getSavedProductIdsAction() {
  return runWithAuditContext({}, async () => {
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return []
    }

    return getUserSavedProductIds(user.id)
  });
}

export async function toggleProductSaveAction(productId: string) {
  return runWithAuditContext({}, async () => {
    const supabase = await createClient()
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()

    if (error || !user) {
      return { error: 'Not authenticated' }
    }

    const alreadySaved = await isProductSaved(user.id, productId)

    if (alreadySaved) {
      await unsaveProduct(user.id, productId)
    } else {
      await saveProduct(user.id, productId)
    }

    return { ok: true as const, saved: !alreadySaved }
  });
}
