import { cache } from 'react'
import { getUserBrands, getBrandBySlugForAdmin, type OwnedBrand } from '@/lib/services/brand-owners'
import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { getImpersonatedBrandSlug } from '@/lib/auth/impersonation'

export type DashboardBrandContext = {
  brand: OwnedBrand
  allBrands: OwnedBrand[]
  isImpersonating: boolean
}

export const resolveDashboardBrand = cache(async (
  userId: string,
  email: string | null,
  requestedSlug?: string
): Promise<DashboardBrandContext | null> => {
  if (!userId) return null
  void requestedSlug

  const ownedBrands = await getUserBrands(userId)

  const impersonatedSlug = await getImpersonatedBrandSlug()
  const hasValidImpersonation = impersonatedSlug
    ? await isActingAsAdmin(email)
    : false
  const activeImpersonatedSlug = hasValidImpersonation
    ? impersonatedSlug
    : null
  const impersonatedOwnedBrand = activeImpersonatedSlug
    ? ownedBrands.find((brand) => brand.brandSlug === activeImpersonatedSlug)
    : undefined
  const effectiveSlug = activeImpersonatedSlug

  let allBrands = [...ownedBrands]
  const isImpersonating = activeImpersonatedSlug !== null

  if (activeImpersonatedSlug && !impersonatedOwnedBrand) {
    const adminBrand = await getBrandBySlugForAdmin(activeImpersonatedSlug)
    if (adminBrand) {
      allBrands = [adminBrand, ...ownedBrands]
    }
  }

  const brand =
    (effectiveSlug ? allBrands.find((b) => b.brandSlug === effectiveSlug) : allBrands[0]) ??
    allBrands[0]

  if (!brand) return null

  return { brand, allBrands, isImpersonating }
})
