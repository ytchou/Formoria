import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createEmailPreferences,
  unsubscribeByToken,
  recordEmailSend,
  hasSent,
  isUnsubscribed,
} from '../email-lifecycle'

const mockSupabase = {
  from: vi.fn(),
}

function mockChain(data: unknown, error: unknown = null) {
  return {
    insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data, error }) }) }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data, error }) }),
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data, error }),
        maybeSingle: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  }
}

describe('email-lifecycle service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createEmailPreferences', () => {
    it('inserts a new preferences row for the user', async () => {
      const chain = mockChain({ user_id: 'user-1', unsubscribe_token: 'token-abc' })
      mockSupabase.from.mockReturnValue(chain)

      const result = await createEmailPreferences(mockSupabase as unknown, 'user-1')

      expect(mockSupabase.from).toHaveBeenCalledWith('owner_email_preferences')
      expect(chain.insert).toHaveBeenCalledWith({ user_id: 'user-1' })
      expect(result.data).toEqual({ user_id: 'user-1', unsubscribe_token: 'token-abc' })
    })
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
  })

  describe('recordEmailSend', () => {
    it('inserts a send record', async () => {
      const chain = mockChain({ id: 'send-1' })
      mockSupabase.from.mockReturnValue(chain)

      await recordEmailSend(mockSupabase as unknown, 'user-1', 'welcome')

      expect(mockSupabase.from).toHaveBeenCalledWith('email_sends')
      expect(chain.insert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-1', template_key: 'welcome' })
      )
    })
  })

  describe('hasSent', () => {
    it('returns true when send exists', async () => {
      const chain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'send-1' }, error: null }),
            }),
          }),
        }),
      }
      mockSupabase.from.mockReturnValue(chain)

      const result = await hasSent(mockSupabase as unknown, 'user-1', 'welcome')
      expect(result).toBe(true)
    })

    it('returns false when no send exists', async () => {
      const chain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }
      mockSupabase.from.mockReturnValue(chain)

      const result = await hasSent(mockSupabase as unknown, 'user-1', 'welcome')
      expect(result).toBe(false)
    })
  })

  describe('isUnsubscribed', () => {
    it('returns true when unsubscribed_at is set', async () => {
      const chain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { unsubscribed_at: '2026-06-12T00:00:00Z' },
              error: null,
            }),
          }),
        }),
      }
      mockSupabase.from.mockReturnValue(chain)

      const result = await isUnsubscribed(mockSupabase as unknown, 'user-1')
      expect(result).toBe(true)
    })

    it('returns false when no preferences row exists', async () => {
      const chain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          }),
        }),
      }
      mockSupabase.from.mockReturnValue(chain)

      const result = await isUnsubscribed(mockSupabase as unknown, 'user-1')
      expect(result).toBe(false)
    })
  })
})
