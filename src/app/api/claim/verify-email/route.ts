import { withAuditScope } from '@/lib/audit/scope'
import { NextRequest, NextResponse } from 'next/server'
import { verifyClaimEmailProof } from '@/lib/services/claim-requests'

function normalizeLocale(value: string | null): 'zh-TW' | 'en' {
  return value === 'en' ? 'en' : 'zh-TW'
}

function redirectUrl(request: NextRequest, path: string): URL {
  return new URL(path, request.url)
}

export const GET = withAuditScope(async (request: NextRequest) => {
  const { searchParams } = request.nextUrl
  const claimRequestId = searchParams.get('cr') ?? ''
  const proofIndex = Number(searchParams.get('i'))
  const token = searchParams.get('token') ?? ''
  const requestedLocale = normalizeLocale(searchParams.get('locale'))

  const result = await verifyClaimEmailProof({
    claimRequestId,
    proofIndex,
    token,
  })

  const locale = requestedLocale ?? result.locale ?? 'zh-TW'
  if (result.ok && result.brandSlug) {
    return NextResponse.redirect(
      redirectUrl(request, `/${locale}/brands/${result.brandSlug}?claim=verified`)
    )
  }

  if (result.brandSlug) {
    return NextResponse.redirect(
      redirectUrl(request, `/${locale}/brands/${result.brandSlug}?claim=verify_failed`)
    )
  }

  return NextResponse.redirect(redirectUrl(request, '/'))
})
