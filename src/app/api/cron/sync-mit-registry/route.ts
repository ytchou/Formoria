import { NextResponse } from 'next/server'
import { syncMitRegistry } from '@/lib/services/mit-registry'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request) {
  if (req.headers.get('x-origin-verify') !== process.env.ORIGIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { recordCount, durationMs } = await syncMitRegistry()
    return NextResponse.json({ recordCount, durationMs })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
