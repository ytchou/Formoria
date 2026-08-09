import { withAuditScope } from '@/lib/audit/scope'
import { NextResponse } from 'next/server'
import { isAuthorizedMachineCaller } from '@/lib/security/machine-caller'
import { purgeExpiredClassifierJunk } from '@/lib/services/image-retention'

export const runtime = 'nodejs'
export const maxDuration = 300

export const POST = withAuditScope(async (req: Request) => {
  if (!isAuthorizedMachineCaller(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await purgeExpiredClassifierJunk()
    return NextResponse.json(summary)
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'classifier_image_retention_failed',
        error: error instanceof Error ? error.name : 'UnknownError',
      }),
    )
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
