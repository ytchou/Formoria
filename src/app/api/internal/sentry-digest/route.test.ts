import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn(),
}))

vi.mock('@react-email/render', () => ({
  render: vi.fn().mockResolvedValue('<html>mock</html>'),
}))

const validPayload = {
  dateRange: '2026-06-20 to 2026-06-21',
  summary: { total: 1, critical: 1, moderate: 0, trivial: 0, noise: 0 },
  issues: [
    {
      title: 'Test Error',
      url: 'https://sentry.io/issues/1',
      eventCount: 5,
      severity: 'critical',
      isNew: true,
      seerAnalysis: 'Root cause identified.',
      recommendedAction: 'Fix the bug.',
    },
  ],
  isIncidentMode: false,
}

describe('POST /api/internal/sentry-digest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ORIGIN_SECRET = 'test-secret'
  })

  it('returns 401 without valid auth header', async () => {
    const { POST } = await import('./route')
    const req = new Request('http://localhost/api/internal/sentry-digest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 401 with wrong secret', async () => {
    const { POST } = await import('./route')
    const req = new Request('http://localhost/api/internal/sentry-digest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-origin-verify': 'wrong-secret',
      },
      body: JSON.stringify(validPayload),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('sends digest email with valid auth', async () => {
    const { sendEmail } = await import('@/lib/email/send')
    const { POST } = await import('./route')
    const req = new Request('http://localhost/api/internal/sentry-digest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-origin-verify': 'test-secret',
      },
      body: JSON.stringify(validPayload),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(sendEmail).toHaveBeenCalledOnce()
  })
})
