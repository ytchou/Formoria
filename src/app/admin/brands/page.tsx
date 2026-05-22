import type { Metadata } from 'next'
import { getBrands } from '@/lib/services/brands'
import { BrandList } from '@/components/admin/brand-list'

export const metadata: Metadata = {
  title: '品牌 | 管理後台 | MIT Map',
}

export default async function BrandsPage() {
  const { brands } = await getBrands()

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Brands
      </h1>
      <p className="mt-2 text-[#7C7570]">Manage all brands in the directory.</p>

      <div className="mt-8">
        <BrandList brands={brands} />
      </div>
    </div>
  )
}
