import { describe, it, expect, vi, beforeEach } from 'vitest'
import { unsubscribeByToken } from '../email-lifecycle'

const mockSupabase = {
  from: vi.fn(),
}

describe('email-lifecycle service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('unsubscribeByToken', () => {
    it('looks up token and sets unsubscribed_at', async () => {
      const selectChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { user_id: 'user-1', unsubscribed_at: null },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }
      mockSupabase.from.mockReturnValue(selectChain)

      const result = await unsubscribeByToken(mockSupabase as unknown, 'token-abc')

      expect(result.success).toBe(true)
    })

    it('returns error for invalid token', async () => {
      const chain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          }),
        }),
      }
      mockSupabase.from.mockReturnValue(chain)

      const result = await unsubscribeByToken(mockSupabase as unknown, 'bad-token')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('is idempotent when the token is already unsubscribed', async () => {
      const chain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                user_id: 'user-1',
                unsubscribed_at: '2026-07-15T00:00:00Z',
              },
              error: null,
            }),
          }),
        }),
      }
      mockSupabase.from.mockReturnValue(chain)

      await expect(
        unsubscribeByToken(mockSupabase as unknown, 'token-abc'),
      ).resolves.toEqual({ success: true })
    })
  })
})
