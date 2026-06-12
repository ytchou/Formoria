import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Deno env and Supabase client for Vitest (Node) environment
const mockRpc = vi.fn()
const mockFrom = vi.fn()
const mockSupabase = { rpc: mockRpc, from: mockFrom }

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}))

// Mock global fetch for Resend API calls
const mockFetch = vi.fn().mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ id: 'msg-1' }),
})
vi.stubGlobal('fetch', mockFetch)

// Import after mocks
import { evaluateDrips, DRIP_TYPES } from '../index'

describe('process-drips Edge Function', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'msg-1' }),
    })
  })

  describe('evaluateDrips', () => {
    it('sends welcome email to newly claimed owners not yet welcomed', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'brand_owners') {
          return {
            select: vi.fn().mockReturnValue({
              gt: vi.fn().mockReturnValue({
                not: vi.fn().mockResolvedValue({
                  data: [{
                    user_id: 'user-1',
                    email: 'owner@test.com',
                    brand_name: 'Tea Co',
                    brand_slug: 'tea-co',
                    unsubscribe_token: 'token-1',
                  }],
                  error: null,
                }),
              }),
            }),
          }
        }
        // email_sends insert
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      })

      const results = await evaluateDrips(mockSupabase as any, 'welcome')

      expect(results.sent).toBe(1)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Tea Co'),
        })
      )
    })

    it('skips unsubscribed owners', async () => {
      mockFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          gt: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }))

      const results = await evaluateDrips(mockSupabase as any, 'welcome')

      expect(results.sent).toBe(0)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('skips owners who already received the email', async () => {
      mockFrom.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          gt: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      }))

      const results = await evaluateDrips(mockSupabase as any, 'profile_nudge')

      expect(results.sent).toBe(0)
    })
  })

  describe('DRIP_TYPES', () => {
    it('defines all expected drip types', () => {
      expect(DRIP_TYPES.map(d => d.key)).toEqual([
        'welcome',
        'profile_nudge',
        'microsite_spotlight',
        're_engagement',
      ])
    })
  })
})
