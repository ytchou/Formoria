import { withAuditScope } from '@/lib/audit/scope'
import { NextResponse } from 'next/server'
import { isAuthorizedMachineCaller } from '@/lib/security/machine-caller'
import { syncMitRegistry } from '@/lib/services/mit-registry'

export const runtime = 'nodejs'
export const maxDuration = 60

export const POST = withAuditScope(async (req: Request) => {
  if (!isAuthorizedMachineCaller(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { recordCount, durationMs } = await syncMitRegistry()
    return NextResponse.json({ recordCount, durationMs })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
})
