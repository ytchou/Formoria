import { auditedCall } from '@/lib/audit'
import { createResendProvider } from './resend-adapter'
import type { EmailMessage, EmailSendResult } from './types'

export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[email] RESEND_API_KEY not configured, skipping email')
    return { success: false, error: 'RESEND_API_KEY not configured' }
  }

  const provider = createResendProvider(apiKey)
  try {
    const result = await auditedCall(
      { provider: 'resend', operation: 'send_email', kind: 'external' },
      () => provider.send(message),
      {
        classify: (sendResult) => sendResult.success ? 'succeeded' : 'failed',
        summary: {
          htmlBytes: Buffer.byteLength(message.html ?? '', 'utf8'),
          subjectPresent: Boolean(message.subject),
          recipientCount: message.to ? 1 : 0,
        },
      },
    )
    if (!result.success) {
      console.error('[email]', { error: result.error })
    }
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[email]', { error: message })
    return { success: false, error: message }
  }
}
