import type { ActionNudge } from '@/lib/services/brand-health'
import type { OwnedBrand } from '@/lib/services/brand-owners'
import { isWithinClaimWindow } from '@/lib/services/claim-window'

export type WelcomeBannerData = {
  completionFraction: number
  topAction?: Pick<ActionNudge, 'labelKey' | 'anchor' | 'points'>
}

export async function getWelcomeBannerData(
  selectedBrand: OwnedBrand
): Promise<WelcomeBannerData | null> {
  if (!isWithinClaimWindow(selectedBrand.claimedAt)) return null

  try {
    const [
      { getBrandBySlug },
      { getAnalytics },
      { computeBrandCompleteness },
      { computeBrandHealth },
    ] = await Promise.all([
      import('@/lib/services/brands'),
      import('@/lib/services/brand-analytics'),
      import('@/lib/services/brand-completeness'),
      import('@/lib/services/brand-health'),
    ])

    const brand = await getBrandBySlug(selectedBrand.brandSlug)
    const analytics = await getAnalytics(brand.id, 30).catch(() => null)
    const completeness = computeBrandCompleteness(brand)
    const health = computeBrandHealth(brand, analytics, new Date(brand.createdAt))

    return {
      completionFraction: completeness.fraction,
      topAction: health.topActions[0],
    }
  } catch {
    return null
  }
}
