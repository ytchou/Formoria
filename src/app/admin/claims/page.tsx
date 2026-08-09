import type { Metadata } from 'next'
import { ClaimRequestsList } from '@/components/admin/claim-requests-list'
import { approveClaimAction, rejectClaimAction } from '@/app/admin/actions'
import { requireAdminPage } from '@/lib/auth/require-admin'
import { attachSignedProofUrls, listClaimRequests } from '@/lib/services/claim-requests'

export const metadata: Metadata = {
  title: 'Claim Requests | Admin',
}

export default async function ClaimRequestsPage() {
  await requireAdminPage('/admin/claims')
  const claimRequests = await attachSignedProofUrls(await listClaimRequests())

  return (
    <div>
      <h1 className="type-page-title-large">
        Claim Requests
      </h1>
      <p className="mt-2 type-body-muted">
        Review and manage brand ownership claims.
      </p>

      <div className="mt-8">
        <ClaimRequestsList
          claimRequests={claimRequests}
          approveAction={approveClaimAction}
          rejectAction={rejectClaimAction}
        />
      </div>
    </div>
  )
}
