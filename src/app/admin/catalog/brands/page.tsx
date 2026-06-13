import type { Metadata } from 'next'
import { getBrands } from '@/lib/services/brands'
import { getUntaggedBrands, getTags } from '@/lib/services/taxonomy'
import { BrandList } from '@/components/admin/brand-list'
import { UntaggedBrandsSection } from '@/components/admin/untagged-brands-section'

export const metadata: Metadata = {
  title: '品牌 | 管理後台',
}

export default async function BrandsPage() {
  const [{ brands }, untaggedBrands, allTags] = await Promise.all([
    getBrands({ includeTestBrands: true }),
    getUntaggedBrands(),
    getTags(),
  ])

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Brands
      </h1>
      <p className="mt-2 text-[#7C7570]">
        Manage all brands in the directory, including MIT verification status.
      </p>

      <div className="mt-8">
        {untaggedBrands.length > 0 && (
          <UntaggedBrandsSection brands={untaggedBrands} allTags={allTags} />
        )}

        <BrandList brands={brands} />
      </div>
    </div>
  )
}
