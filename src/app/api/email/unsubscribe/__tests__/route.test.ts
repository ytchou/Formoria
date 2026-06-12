import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '../route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/services/email-lifecycle', () => ({
  unsubscribeByToken: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase/server'
import { unsubscribeByToken } from '@/lib/services/email-lifecycle'

describe('GET /api/email/unsubscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 if token is missing', async () => {
    const req = new NextRequest('http://localhost/api/email/unsubscribe')
    const res = await GET(req)
    expect(res.status).toBe(400)
  })

  it('unsubscribes and returns confirmation HTML for valid token', async () => {
    vi.mocked(createServiceClient).mockReturnValue({} as any)
    vi.mocked(unsubscribeByToken).mockResolvedValue({ success: true })

    const req = new NextRequest(
      'http://localhost/api/email/unsubscribe?token=valid-token-uuid'
    )
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const body = await res.text()
    expect(body).toContain('unsubscribed')
    expect(unsubscribeByToken).toHaveBeenCalledWith(expect.anything(), 'valid-token-uuid')
  })

  it('returns 404 for invalid token', async () => {
    vi.mocked(createServiceClient).mockReturnValue({} as any)
    vi.mocked(unsubscribeByToken).mockResolvedValue({
      success: false,
      error: 'Token not found',
    })

    const req = new NextRequest('http://localhost/api/email/unsubscribe?token=bad-token')
    const res = await GET(req)

    expect(res.status).toBe(404)
  })
})
