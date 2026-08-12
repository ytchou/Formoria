import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAuditEmitterForTests, setAuditWriteSeam, type AuditRecord } from '@/lib/audit'

const providerSend = vi.fn()
let writes: AuditRecord[]

vi.mock('./resend-adapter', () => ({
  createResendProvider: vi.fn(() => ({ send: providerSend })),
}))

import { sendEmail } from './send'

const message = {
  to: 'owner@example.com',
  from: 'Formoria <noreply@formoria.com>',
  subject: 'Test',
  html: '<p>Test</p>',
}

describe('sendEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    writes = []
    setAuditWriteSeam(async (record) => {
      writes.push(record)
      return null
    })
  })

  afterEach(() => {
    resetAuditEmitterForTests()
  })

  it('awaits and returns the provider result', async () => {
    providerSend.mockResolvedValue({ success: true, messageId: 'msg-1' })

    await expect(sendEmail(message)).resolves.toEqual({
      success: true,
      messageId: 'msg-1',
    })
  })

  it('returns a failure result when email delivery is not configured', async () => {
    vi.stubEnv('RESEND_API_KEY', '')

    await expect(sendEmail(message)).resolves.toEqual({
      success: false,
      error: 'RESEND_API_KEY not configured',
    })
    expect(providerSend).not.toHaveBeenCalled()
  })

  it('sendEmail writes a span without capturing the rendered HTML body', async () => {
    const html = '<p>private rendered content</p>'
    providerSend.mockResolvedValue({ success: true, messageId: 'msg-1' })

    await sendEmail({ ...message, html })

    const recordsJson = JSON.stringify(writes)
    expect(recordsJson).toContain(`"htmlBytes":${Buffer.byteLength(html, 'utf8')}`)
    expect(recordsJson).not.toContain(html)
  })

  it('does not deliver email from staging even when credentials are configured', async () => {
    vi.stubEnv('FORMORIA_DEPLOYMENT_ENV', 'staging')

    await expect(sendEmail(message)).resolves.toEqual({
      success: false,
      error: 'Email delivery disabled in staging',
    })
    expect(providerSend).not.toHaveBeenCalled()
  })
})
