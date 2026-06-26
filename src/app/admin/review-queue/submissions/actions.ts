'use server'

import { createClient } from '@/lib/supabase/server'
import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { approveSubmissionAction } from '@/app/admin/actions'
import type { OtherUrl } from '@/lib/types'

export type SubmissionApprovalOverrides = {
  description?: string | null
  productType?: string | null
  purchaseWebsite?: string | null
  purchasePinkoi?: string | null
  purchaseShopee?: string | null
  socialInstagram?: string | null
  socialThreads?: string | null
  socialFacebook?: string | null
  otherUrls?: OtherUrl[]
}

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

async function requireAdmin(): Promise<{ error: string } | undefined> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return { error: 'Unauthorized' }

  const actingAsAdmin = await isActingAsAdmin(user.email)
  if (!actingAsAdmin) return { error: 'Forbidden' }

  return undefined
}

export async function approveSubmissionWithOverridesAction(
  submissionId: string,
  overrides: SubmissionApprovalOverrides
): ReturnType<typeof approveSubmissionAction> {
  const authError = await requireAdmin()
  if (authError) return authError

  return approveSubmissionAction(submissionId, {
    description: emptyToNull(overrides.description),
    productType: emptyToNull(overrides.productType),
    purchaseWebsite: emptyToNull(overrides.purchaseWebsite),
    purchasePinkoi: emptyToNull(overrides.purchasePinkoi),
    purchaseShopee: emptyToNull(overrides.purchaseShopee),
    socialInstagram: emptyToNull(overrides.socialInstagram),
    socialThreads: emptyToNull(overrides.socialThreads),
    socialFacebook: emptyToNull(overrides.socialFacebook),
    otherUrls:
      overrides.otherUrls
        ?.map((link) => ({
          label: link.label.trim(),
          url: link.url.trim(),
        }))
        .filter((link) => link.label || link.url) ?? [],
  })
}
