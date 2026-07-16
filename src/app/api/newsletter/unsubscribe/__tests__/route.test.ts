import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { extractToken } from '../helpers'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/services/newsletter', () => ({
  unsubscribeNewsletter: vi.fn(),
}))

import { createServiceClient } from '@/lib/supabase/server'
import { unsubscribeNewsletter } from '@/lib/services/newsletter'
import { POST } from '../route'

describe('newsletter unsubscribe route — helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('extractToken', () => {
    it('extracts token from search params', () => {
      const url = new URL('http://localhost/api/newsletter/unsubscribe?token=xyz-789')
      expect(extractToken(url)).toBe('xyz-789')
    })

    it('returns null for missing token', () => {
      const url = new URL('http://localhost/api/newsletter/unsubscribe')
      expect(extractToken(url)).toBeNull()
    })
  })

  it('supports RFC 8058 one-click POST', async () => {
    vi.mocked(createServiceClient).mockReturnValue({} as ReturnType<typeof createServiceClient>)
    vi.mocked(unsubscribeNewsletter).mockResolvedValue({
      success: true,
      subscriber: {} as never,
    })

    const request = new NextRequest(
      'http://localhost/api/newsletter/unsubscribe?token=newsletter-token',
      { method: 'POST' },
    )
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(unsubscribeNewsletter).toHaveBeenCalledWith(
      expect.anything(),
      'newsletter-token',
    )
  })
})
