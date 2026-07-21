import { NextResponse } from 'next/server'
import { runLinkHealthCheck } from '@/lib/services/link-health'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  if (req.headers.get('x-origin-verify') !== process.env.ORIGIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const summary = await runLinkHealthCheck()
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
