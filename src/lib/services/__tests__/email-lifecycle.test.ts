import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createEmailPreferences,
  unsubscribeByToken,
  recordEmailSend,
  hasSent,
  isUnsubscribed,
  isLifecycleOptedIn,
  setLifecycleEmailPreference,
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
    it('upserts a preferences row without resetting existing consent', async () => {
      const single = vi.fn().mockResolvedValue({
        data: { user_id: 'user-1', unsubscribe_token: 'token-abc' },
        error: null,
      })
      const upsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ single }),
      })
      mockSupabase.from.mockReturnValue({ upsert })

      const result = await createEmailPreferences(mockSupabase as unknown, 'user-1')

      expect(mockSupabase.from).toHaveBeenCalledWith('owner_email_preferences')
      expect(upsert).toHaveBeenCalledWith(
        { user_id: 'user-1' },
        { onConflict: 'user_id' },
      )
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

  describe('explicit lifecycle consent', () => {
    it('records source, version, time, and a fresh unsubscribe token', async () => {
      const single = vi.fn().mockResolvedValue({ data: { user_id: 'user-1' }, error: null })
      const upsert = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single }) })
      const tokenLookup = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }
      mockSupabase.from
        .mockReturnValueOnce(tokenLookup)
        .mockReturnValueOnce({ upsert })

      await setLifecycleEmailPreference(mockSupabase as unknown, {
        userId: 'user-1',
        enabled: true,
        consentSource: 'account_signup',
        consentVersion: '2026-07-16',
      })

      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-1',
          lifecycle_opted_in_at: expect.any(String),
          consent_source: 'account_signup',
          consent_version: '2026-07-16',
          unsubscribed_at: null,
          unsubscribe_token: expect.any(String),
        }),
        { onConflict: 'user_id' },
      )
    })

    it('treats a missing preference row as opted out', async () => {
      const chain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }
      mockSupabase.from.mockReturnValue(chain)

      await expect(
        isLifecycleOptedIn(mockSupabase as unknown, 'user-1'),
      ).resolves.toBe(false)
    })

    it('requires an opt-in timestamp and no unsubscribe timestamp', async () => {
      const chain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                lifecycle_opted_in_at: '2026-07-16T00:00:00Z',
                unsubscribed_at: null,
              },
              error: null,
            }),
          }),
        }),
      }
      mockSupabase.from.mockReturnValue(chain)

      await expect(
        isLifecycleOptedIn(mockSupabase as unknown, 'user-1'),
      ).resolves.toBe(true)
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
