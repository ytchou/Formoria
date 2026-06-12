export type EmailMessage = {
  to: string
  from: string
  subject: string
  html: string
  replyTo?: string
  headers?: Record<string, string>
}

export type EmailSendResult = {
  success: boolean
  messageId?: string
  error?: string
}

export type EmailProvider = {
  send(message: EmailMessage): Promise<EmailSendResult>
}
