import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { ClaimRequestsList } from '@/components/admin/claim-requests-list'
import { isActingAsAdmin } from '@/lib/auth/admin-mode'
import { attachSignedProofUrls, listClaimRequests } from '@/lib/services/claim-requests'
import { createClient } from '@/lib/supabase/server'
import messages from '../../../../messages/zh-TW.json'

export const metadata: Metadata = {
  title: 'Claim Requests | Admin',
}

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/sign-in?next=/admin/claim-requests')
  }

  if (!(await isActingAsAdmin(user.email))) {
    redirect('/')
  }
}

export default async function ClaimRequestsPage() {
  await requireAdmin()
  const claimRequests = await attachSignedProofUrls(await listClaimRequests())

  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        Claim Requests
      </h1>
      <p className="mt-2 text-muted-foreground">
        Review and manage brand ownership claims.
      </p>

      <div className="mt-8">
        <NextIntlClientProvider locale="zh-TW" messages={messages}>
          <ClaimRequestsList claimRequests={claimRequests} />
        </NextIntlClientProvider>
      </div>
    </div>
  )
}
