'use server'

import { runWithAuditContext } from '@/lib/audit/context'
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

export async function getViewerContextAction(): Promise<ViewerContext> {
  return runWithAuditContext({}, async () => {
    const supabase = await createClient()

    // Signed-out visitors are the claim funnel's entry point, so the flag is read
    // on every path — not just the authenticated one. It does not depend on the
    // session, so it resolves alongside the auth lookup rather than after it.
    //
    // Every branch below spells out all four fields instead of spreading a
    // default: a field added later must then fail to compile on each branch,
    // rather than silently defaulting for one class of viewer.
    const [
      {
        data: { user },
      },
      ownerFeaturesEnabled,
    ] = await Promise.all([supabase.auth.getUser(), isOwnerFeaturesEnabled()])

    if (!user) {
      return {
        hasOwnedBrand: false,
        isAdmin: false,
        ownerFeaturesEnabled,
        impersonation: null,
      }
    }

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
  });
}
