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
  const ownedBrands = await getUserBrands(userId)

  const impersonatedSlug = await getImpersonatedBrandSlug()
  const effectiveSlug = impersonatedSlug ?? requestedSlug

  let allBrands = [...ownedBrands]
  let isImpersonating = false

  if (effectiveSlug && !ownedBrands.some((b) => b.brandSlug === effectiveSlug)) {
    const acting = await isActingAsAdmin(email)
    if (acting) {
      const adminBrand = await getBrandBySlugForAdmin(effectiveSlug)
      if (adminBrand) {
        allBrands = [adminBrand, ...ownedBrands]
        isImpersonating = !!impersonatedSlug
      }
    }
  }

  const brand =
    (effectiveSlug ? allBrands.find((b) => b.brandSlug === effectiveSlug) : allBrands[0]) ??
    allBrands[0]

  if (!brand) return null

  return { brand, allBrands, isImpersonating }
})
