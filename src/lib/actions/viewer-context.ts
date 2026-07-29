'use server'

import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import {
  getImpersonatedBrandSlug,
  getImpersonationExpiresAt,
} from '@/lib/auth/impersonation'
import { isOwnerFeaturesEnabled } from '@/lib/services/app-settings'
import {
  getBrandBySlugForAdmin,
  getUserBrand,
} from '@/lib/services/brand-owners'
import { createClient } from '@/lib/supabase/server'

export type ViewerContext = {
  hasOwnedBrand: boolean
  isAdmin: boolean
  /**
   * Owner-features kill switch, read per request. Separate from
   * `hasOwnedBrand`, which keeps its own inverted-polarity meaning.
   */
  ownerFeaturesEnabled: boolean
  impersonation: {
    brandName: string
    expiresAt: number
  } | null
}

const EMPTY_VIEWER_CONTEXT: ViewerContext = {
  hasOwnedBrand: false,
  isAdmin: false,
  ownerFeaturesEnabled: false,
  impersonation: null,
}

export async function getViewerContextAction(): Promise<ViewerContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Signed-out visitors are the claim funnel's entry point, so the flag is read
  // on every path — not just the authenticated one.
  const ownerFeaturesEnabled = await isOwnerFeaturesEnabled()

  if (!user) return { ...EMPTY_VIEWER_CONTEXT, ownerFeaturesEnabled }

  const [ownedBrand, isAdmin] = await Promise.all([
    getUserBrand(user.id),
    isActingAsAdmin(user.email),
  ])

  if (!isAdmin) {
    return {
      hasOwnedBrand: Boolean(ownedBrand),
      isAdmin: false,
      ownerFeaturesEnabled,
      impersonation: null,
    }
  }

  const [slug, expiresAt] = await Promise.all([
    getImpersonatedBrandSlug(),
    getImpersonationExpiresAt(),
  ])
  const impersonatedBrand = slug ? await getBrandBySlugForAdmin(slug) : null

  return {
    hasOwnedBrand: Boolean(ownedBrand),
    isAdmin: true,
    ownerFeaturesEnabled,
    impersonation:
      impersonatedBrand && expiresAt
        ? { brandName: impersonatedBrand.brandName, expiresAt }
        : null,
  }
}
