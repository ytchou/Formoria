import { withAuditScope } from '@/lib/audit/scope'
import { NextResponse } from 'next/server'

export const GET = withAuditScope(() => {
  return NextResponse.json({ status: 'ok' })
})
