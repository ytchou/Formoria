import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerSend = vi.fn()

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
})
