import { getUserBrands } from '@/lib/services/brand-owners'
import type { OwnedBrand } from '@/lib/services/brand-owners'

export async function resolveBrand(
  searchParams: { brand?: string },
  userId: string
): Promise<OwnedBrand | null> {
  const brands = await getUserBrands(userId)

  return (
    brands.find((brand) => brand.brandSlug === searchParams.brand) ??
    brands[0] ??
    null
  )
}
