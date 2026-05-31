import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createResendProvider } from './resend-adapter'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('createResendProvider', () => {
  const provider = createResendProvider('test-api-key')
  const testMessage = {
    to: 'user@example.com',
    from: 'Formoria <noreply@formoria.com>',
    subject: 'Test',
    html: '<p>Hello</p>',
  }

  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('sends email via Resend REST API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'msg_123' }),
    })

    const result = await provider.send(testMessage)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-api-key',
        }),
      }),
    )
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg_123')
  })

  it('returns error on API failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => 'Invalid email address',
    })

    const result = await provider.send(testMessage)

    expect(result.success).toBe(false)
    expect(result.error).toContain('422')
  })

  it('passes replyTo when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'msg_456' }),
    })

    await provider.send({ ...testMessage, replyTo: 'reply@example.com' })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.reply_to).toBe('reply@example.com')
  })
})
