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

function thenableQuery(result: { data: unknown[]; error: unknown }) {
  const promise = Promise.resolve(result)
  return {
    lt: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  }
}

function setupDripQueries({
  owners = [],
  sentRows = [],
  unsubscribedRows = [],
  ownerError = null,
  sentError = null,
  preferencesError = null,
  insertError = null,
}: {
  owners?: unknown[]
  sentRows?: unknown[]
  unsubscribedRows?: unknown[]
  ownerError?: unknown
  sentError?: unknown
  preferencesError?: unknown
  insertError?: unknown
} = {}) {
  const ownerQuery = thenableQuery({ data: owners, error: ownerError })
  const insert = vi.fn().mockResolvedValue({ error: insertError })
  const sentEq = vi.fn().mockResolvedValue({ data: sentRows, error: sentError })
  const preferencesNot = vi.fn().mockResolvedValue({ data: unsubscribedRows, error: preferencesError })

  mockFrom.mockImplementation((table: string) => {
    if (table === 'brand_owners') {
      return {
        select: vi.fn().mockReturnValue(ownerQuery),
      }
    }

    if (table === 'email_sends') {
      return {
        select: vi.fn().mockReturnValue({ eq: sentEq }),
        insert,
      }
    }

    if (table === 'owner_email_preferences') {
      return {
        select: vi.fn().mockReturnValue({ not: preferencesNot }),
      }
    }

    return {}
  })

  return { ownerQuery, insert, sentEq, preferencesNot }
}

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
      const { ownerQuery, insert, sentEq, preferencesNot } = setupDripQueries({
        owners: [{
          user_id: 'user-1',
          email: { email: 'owner@test.com' },
          brands: { name: 'Tea Co', slug: 'tea-co' },
          owner_email_preferences: { unsubscribe_token: 'token-1' },
        }],
      })

      const results = await evaluateDrips(mockSupabase as Parameters<typeof evaluateDrips>[0], 'welcome')

      expect(results.sent).toBe(1)
      expect(ownerQuery.lt).toHaveBeenCalledWith('claimed_at', expect.any(String))
      expect(sentEq).toHaveBeenCalledWith('template_key', 'welcome')
      expect(preferencesNot).toHaveBeenCalledWith('unsubscribed_at', 'is', null)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Tea Co'),
        })
      )
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
        to: 'owner@test.com',
      })
      expect(insert).toHaveBeenCalledWith({
        user_id: 'user-1',
        template_key: 'welcome',
      })
    })

    it('skips unsubscribed owners', async () => {
      const { insert } = setupDripQueries({
        owners: [{
          user_id: 'user-1',
          email: 'owner@test.com',
          brand_name: 'Tea Co',
          brand_slug: 'tea-co',
          unsubscribe_token: 'token-1',
        }],
        unsubscribedRows: [{ user_id: 'user-1' }],
      })

      const results = await evaluateDrips(mockSupabase as Parameters<typeof evaluateDrips>[0], 'welcome')

      expect(results.sent).toBe(0)
      expect(mockFetch).not.toHaveBeenCalled()
      expect(insert).not.toHaveBeenCalled()
    })

    it('skips owners who already received the email', async () => {
      const { insert } = setupDripQueries({
        owners: [{
          user_id: 'user-1',
          email: 'owner@test.com',
          brand_name: 'Tea Co',
          brand_slug: 'tea-co',
          unsubscribe_token: 'token-1',
        }],
        sentRows: [{ user_id: 'user-1' }],
      })

      const results = await evaluateDrips(mockSupabase as Parameters<typeof evaluateDrips>[0], 'profile_nudge')

      expect(results.sent).toBe(0)
      expect(mockFetch).not.toHaveBeenCalled()
      expect(insert).not.toHaveBeenCalled()
    })

    it('filters microsite spotlight to brands with site content enabled', async () => {
      const { ownerQuery } = setupDripQueries()

      await evaluateDrips(mockSupabase as Parameters<typeof evaluateDrips>[0], 'microsite_spotlight')

      expect(ownerQuery.eq).toHaveBeenCalledWith('brands.site_content->>enabled', 'true')
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
