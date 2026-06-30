import type { OwnedBrand } from '@/lib/services/brand-owners'
import type { PendingBrandEdit } from '@/lib/types/brand'

export async function getLatestReview(
  selectedBrand: OwnedBrand,
  user: { id: string }
): Promise<PendingBrandEdit | null> {
  try {
    const { getLatestEditReview } = await import('@/lib/services/pending-edits')
    return await getLatestEditReview(selectedBrand.brandId, user.id)
  } catch {
    return null
  }
}
