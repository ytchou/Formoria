import { withAuditScope } from '@/lib/audit/scope'
import { NextResponse } from 'next/server'
import { isAuthorizedMachineCaller } from '@/lib/security/machine-caller'
import { syncMitRegistry } from '@/lib/services/mit-registry'

export const runtime = 'nodejs'
// 300s, matching the other cron routes. The old 60s had to cover the ZIP
// download, parse and ~60 sequential upsert batches for a 29k-row dataset —
// the tightest budget in the codebase, for the largest job.
export const maxDuration = 300

export const POST = withAuditScope(async (req: Request) => {
  if (!isAuthorizedMachineCaller(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { recordCount, durationMs, sweptStale } = await syncMitRegistry()
    return NextResponse.json({ recordCount, durationMs, sweptStale })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
})
