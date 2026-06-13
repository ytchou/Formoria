import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('@/lib/services/feedback', () => ({
  createFeedbackFromTally: vi.fn().mockResolvedValue(undefined),
}))

const SIGNING_SECRET = 'test_secret_key_abc123'

const TALLY_PAYLOAD = JSON.stringify({
  eventId: 'evt_001',
  eventType: 'FORM_RESPONSE',
  data: {
    responseId: 'resp_001',
    fields: [
      { label: 'type', type: 'MULTIPLE_CHOICE', value: 'feedback' },
      { label: 'message', type: 'TEXTAREA', value: 'Really helpful directory!' },
    ],
    pageContext: { url: 'https://formoria.com/brands/some-brand' },
  },
})

function computeHmac(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function makeRequest(body: string, signatureHeader?: string): Request {
  return new Request('http://localhost/api/webhooks/tally', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signatureHeader !== undefined ? { 'tally-signature': signatureHeader } : {}),
    },
    body,
  })
}

describe('POST /api/webhooks/tally', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TALLY_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET
  })

  it('returns 200 with valid HMAC signature', async () => {
    const { POST } = await import('./route')
    const sig = computeHmac(TALLY_PAYLOAD, SIGNING_SECRET)
    const res = await POST(makeRequest(TALLY_PAYLOAD, sig))
    expect(res.status).toBe(200)
  })

  it('returns 401 with invalid signature', async () => {
    const { POST } = await import('./route')
    const res = await POST(makeRequest(TALLY_PAYLOAD, 'invalid_sig'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when Tally-Signature header is missing', async () => {
    const { POST } = await import('./route')
    const res = await POST(makeRequest(TALLY_PAYLOAD))
    expect(res.status).toBe(401)
  })

  it('returns 500 when TALLY_WEBHOOK_SIGNING_SECRET is not set', async () => {
    delete process.env.TALLY_WEBHOOK_SIGNING_SECRET
    const { POST } = await import('./route')
    const sig = computeHmac(TALLY_PAYLOAD, SIGNING_SECRET)
    const res = await POST(makeRequest(TALLY_PAYLOAD, sig))
    expect(res.status).toBe(500)
  })

  it('returns 400 when payload is malformed', async () => {
    const { POST } = await import('./route')
    const badBody = 'not-json'
    const sig = computeHmac(badBody, SIGNING_SECRET)
    const res = await POST(makeRequest(badBody, sig))
    expect(res.status).toBe(400)
  })

  it('calls createFeedbackFromTally with mapped fields', async () => {
    const { POST } = await import('./route')
    const { createFeedbackFromTally } = await import('@/lib/services/feedback')
    const sig = computeHmac(TALLY_PAYLOAD, SIGNING_SECRET)
    await POST(makeRequest(TALLY_PAYLOAD, sig))

    expect(createFeedbackFromTally).toHaveBeenCalledWith(
      expect.objectContaining({
        tallyResponseId: 'resp_001',
        type: 'feedback',
        body: 'Really helpful directory!',
      })
    )
  })
})
