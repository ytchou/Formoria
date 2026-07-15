'use server'

import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import {
  getImpersonatedBrandSlug,
  getImpersonationExpiresAt,
} from '@/lib/auth/impersonation'
import {
  getBrandBySlugForAdmin,
  getUserBrand,
} from '@/lib/services/brand-owners'
import { createClient } from '@/lib/supabase/server'

export type ViewerContext = {
  hasOwnedBrand: boolean
  isAdmin: boolean
  impersonation: {
    brandName: string
    expiresAt: number
  } | null
}

const EMPTY_VIEWER_CONTEXT: ViewerContext = {
  hasOwnedBrand: false,
  isAdmin: false,
  impersonation: null,
}

export async function getViewerContextAction(): Promise<ViewerContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return EMPTY_VIEWER_CONTEXT

  const [ownedBrand, isAdmin] = await Promise.all([
    getUserBrand(user.id),
    isActingAsAdmin(user.email),
  ])

  if (!isAdmin) {
    return {
      hasOwnedBrand: Boolean(ownedBrand),
      isAdmin: false,
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
    impersonation:
      impersonatedBrand && expiresAt
        ? { brandName: impersonatedBrand.brandName, expiresAt }
        : null,
  }
}
