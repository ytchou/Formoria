import { NextResponse } from 'next/server'
import { purgeExpiredClassifierJunk } from '@/lib/services/image-retention'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  if (req.headers.get('x-origin-verify') !== process.env.ORIGIN_SECRET) {
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
}
