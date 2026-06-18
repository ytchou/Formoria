import { NextResponse } from 'next/server'
import { DRIP_TYPES, evaluateDrips } from '@/lib/services/drip-processing'

export async function POST(req: Request) {
  if (req.headers.get('x-origin-verify') !== process.env.ORIGIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const details: { dripType: string; sent: number; errors: number }[] = []
  let sent = 0
  let skipped = 0
  let errors = 0

  for (const drip of DRIP_TYPES) {
    const result = await evaluateDrips(drip.key)
    details.push({ dripType: drip.key, sent: result.sent, errors: result.errors })
    sent += result.sent
    skipped += result.skipped
    errors += result.errors
  }

  return NextResponse.json({ sent, skipped, errors, details })
}
