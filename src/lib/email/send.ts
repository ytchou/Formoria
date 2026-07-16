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
    const result = await provider.send(message)
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
