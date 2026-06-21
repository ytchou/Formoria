import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email/send'
import { buildSentryTriageDigestEmail } from '@emails/templates/sentry-triage-digest'

export async function POST(req: Request) {
  if (req.headers.get('x-origin-verify') !== process.env.ORIGIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json()
    const emailMessage = await buildSentryTriageDigestEmail({
      ...body,
      to: process.env.ADMIN_EMAIL || 'patrick.ytchou@gmail.com',
    })

    await sendEmail(emailMessage)

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
