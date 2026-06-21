import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('sendDigestEmail', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv, RESEND_API_KEY: 're_test_123' }
    mockFetch.mockReset()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('sends email with correct Resend API payload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ id: 'email_123' }),
    })

    const { sendDigestEmail } = await import('../send-digest-email')

    await sendDigestEmail({
      subject: '[Growth Pulse] Jun 21 — 150 sessions (↑12%)',
      html: '<h1>Daily Digest</h1><p>Traffic up 12%</p>',
    })

    expect(mockFetch).toHaveBeenCalledWith('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer re_test_123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Formoria <noreply@formoria.com>',
        to: ['patrick.ytchou@gmail.com'],
        subject: '[Growth Pulse] Jun 21 — 150 sessions (↑12%)',
        html: '<h1>Daily Digest</h1><p>Traffic up 12%</p>',
      }),
    })
  })

  it('throws if RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY

    const { sendDigestEmail } = await import('../send-digest-email')

    await expect(
      sendDigestEmail({ subject: 'test', html: '<p>test</p>' })
    ).rejects.toThrow('RESEND_API_KEY')
  })

  it('throws if Resend API returns error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Invalid API key'),
    })

    const { sendDigestEmail } = await import('../send-digest-email')

    await expect(
      sendDigestEmail({ subject: 'test', html: '<p>test</p>' })
    ).rejects.toThrow('Resend API error')
  })
})
