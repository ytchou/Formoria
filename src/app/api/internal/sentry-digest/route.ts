import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sendEmail } from '@/lib/email/send'
import { buildSentryTriageDigestEmail } from '@emails/templates/sentry-triage-digest'

const digestIssueSchema = z.object({
  title: z.string(),
  url: z.string(),
  eventCount: z.number(),
  severity: z.enum(['critical', 'moderate', 'trivial', 'noise']),
  isNew: z.boolean(),
  seerAnalysis: z.string(),
  recommendedAction: z.string(),
})

const digestSummarySchema = z.object({
  total: z.number(),
  critical: z.number(),
  moderate: z.number(),
  trivial: z.number(),
  noise: z.number(),
})

const sentryDigestRequestSchema = z.object({
  dateRange: z.string(),
  summary: digestSummarySchema,
  issues: z.array(digestIssueSchema),
  isIncidentMode: z.boolean(),
  phase: z.string().optional(),
})

export async function POST(req: Request) {
  if (req.headers.get('x-origin-verify') !== process.env.ORIGIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const bodyResult = await req.json().then(
    (json: unknown) => sentryDigestRequestSchema.safeParse(json),
    () => null,
  )

  if (!bodyResult?.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const body = bodyResult.data
    const emailMessage = await buildSentryTriageDigestEmail({
      ...body,
      phase: body.phase || 'Phase 1 — read-only mode',
      to: process.env.ADMIN_EMAIL || 'patrick.ytchou@gmail.com',
    })

    await sendEmail(emailMessage)

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
