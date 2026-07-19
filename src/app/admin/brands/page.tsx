import type { Metadata } from 'next'
import { getBrands } from '@/lib/services/brands'
import { getApprovedOwnerSubmissionRecipients } from '@/lib/services/submissions'
import { BrandList } from '@/components/admin/brand-list'

export const metadata: Metadata = {
  title: 'Brands | Admin',
}

export default async function BrandsPage() {
  const { brands } = await getBrands({ includeTestBrands: true })
  const resendableBrandIds = brands
    .filter((brand) => brand.status === 'approved' && !brand.isVerified)
    .map((brand) => brand.id)
  const claimInviteRecipients = await getApprovedOwnerSubmissionRecipients(
    resendableBrandIds
  )

  return (
    <div>
      <h1 className="type-page-title-large">
        Brands
      </h1>
      <p className="mt-2 type-body-muted">
        Manage all brands in the directory, including MIT verification status.
      </p>

      <div className="mt-8">
        <BrandList
          brands={brands}
          claimInviteBrandIds={[...claimInviteRecipients.keys()]}
        />
      </div>
    </div>
  )
}
