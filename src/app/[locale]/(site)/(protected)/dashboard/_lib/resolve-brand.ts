import { resolveDashboardBrand } from '@/lib/services/resolve-dashboard-brand'
import type { OwnedBrand } from '@/lib/services/brand-owners'

export async function resolveBrand(
  searchParams: { brand?: string },
  userId: string,
  email?: string | null
): Promise<OwnedBrand | null> {
  const ctx = await resolveDashboardBrand(userId, email ?? null, searchParams.brand)
  return ctx?.brand ?? null
}
