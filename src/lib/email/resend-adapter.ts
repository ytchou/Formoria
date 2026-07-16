import type { EmailMessage, EmailProvider, EmailSendResult } from './types'

const RESEND_API_URL = 'https://api.resend.com/emails'

export function createResendProvider(apiKey: string): EmailProvider {
  return {
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const startedAt = Date.now()
      const body: Record<string, unknown> = {
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
      }

      if (message.replyTo) {
        body.reply_to = message.replyTo
      }

      if (message.headers) {
        body.headers = message.headers
      }

      const requestPayload = {
        from: message.from,
        to: message.to,
        subject: message.subject,
        replyTo: message.replyTo ?? null,
        headers: message.headers ?? null,
        htmlBytes: new TextEncoder().encode(message.html).byteLength,
      }

      try {
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
          const result = {
            success: false as const,
            error: `Resend API error ${response.status}: ${text}`,
          }
          console.info('[email:resend:audit]', {
            request: requestPayload,
            response: { status: response.status, error: text },
            latencyMs: Date.now() - startedAt,
            status: 'error',
          })
          return result
        }

        const data = await response.json() as { id?: string }
        console.info('[email:resend:audit]', {
          request: requestPayload,
          response: { status: response.status, messageId: data.id ?? null },
          latencyMs: Date.now() - startedAt,
          status: 'success',
        })
        return { success: true, messageId: data.id }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.info('[email:resend:audit]', {
          request: requestPayload,
          response: { error: errorMessage },
          latencyMs: Date.now() - startedAt,
          status: 'network_error',
        })
        return { success: false, error: errorMessage }
      }
    },
  }
}
