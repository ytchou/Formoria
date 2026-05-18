import type { EmailMessage, EmailProvider, EmailSendResult } from './types'

const RESEND_API_URL = 'https://api.resend.com/emails'

export function createResendProvider(apiKey: string): EmailProvider {
  return {
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const body: Record<string, unknown> = {
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
      }

      if (message.replyTo) {
        body.reply_to = message.replyTo
      }

      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const text = await response.text()
        return { success: false, error: `Resend API error ${response.status}: ${text}` }
      }

      const data = await response.json()
      return { success: true, messageId: data.id }
    },
  }
}
