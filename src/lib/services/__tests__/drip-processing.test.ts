import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}))

// Mock the template builders
vi.mock('@/lib/email/templates', () => ({
  buildWelcomeEmail: vi.fn().mockResolvedValue({
    to: 'test@example.com',
    from: 'Formoria <noreply@formoria.com>',
    subject: 'Welcome',
    html: '<p>Welcome</p>',
    headers: {},
  }),
  buildProfileNudgeEmail: vi.fn().mockResolvedValue({
    to: 'test@example.com',
    from: 'Formoria <noreply@formoria.com>',
    subject: 'Nudge',
    html: '<p>Nudge</p>',
    headers: {},
  }),
  buildMicrositeSpotlightEmail: vi.fn().mockResolvedValue({
    to: 'test@example.com',
    from: 'Formoria <noreply@formoria.com>',
    subject: 'Spotlight',
    html: '<p>Spotlight</p>',
    headers: {},
  }),
  buildReEngagementEmail: vi.fn().mockResolvedValue({
    to: 'test@example.com',
    from: 'Formoria <noreply@formoria.com>',
    subject: 'Re-engage',
    html: '<p>Re-engage</p>',
    headers: {},
  }),
}))

import { DRIP_TYPES, evaluateDrips } from '@/lib/services/drip-processing'
import { sendEmail } from '@/lib/email/send'

function eligibleOwner() {
  return {
    user_id: 'u1',
    claimed_at: '2026-01-01T00:00:00Z',
    brands: [{
      name: 'Owner Brand',
      slug: 'owner-brand',
      brand_images: [],
      product_tags: [],
      other_urls: [],
    }],
    owner_email_preferences: [{ unsubscribe_token: 'unsubscribe-token' }],
    email: [{ email: 'owner@example.com' }],
  }
}

function mockDripClient(activeUserIds: string[]) {
  const deleteSecondEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const deleteFirstEq = vi.fn().mockReturnValue({ eq: deleteSecondEq })
  const deleteRows = vi.fn().mockReturnValue({ eq: deleteFirstEq })
  const insert = vi.fn().mockResolvedValue({ error: null })

  return {
    deleteRows,
    from: vi.fn((table: string) => {
      if (table === 'brand_owners') {
        return {
          select: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({
              data: [eligibleOwner()],
              error: null,
            }),
          }),
        }
      }
      if (table === 'owner_email_preferences') {
        return {
          select: vi.fn().mockReturnValue({
            not: vi.fn().mockReturnValue({
              is: vi.fn().mockResolvedValue({
                data: activeUserIds.map((user_id) => ({ user_id })),
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }
      }
      return { insert, delete: deleteRows }
    }),
  }
}

describe('DRIP_TYPES', () => {
  it('exports 4 drip types', () => {
    expect(DRIP_TYPES).toHaveLength(4)
    expect(DRIP_TYPES.map((d) => d.key)).toEqual([
      'welcome', 'profile_nudge', 'microsite_spotlight', 're_engagement',
    ])
  })
})

describe('evaluateDrips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns summary with sent/skipped/errors counts', async () => {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const mockFrom = vi.fn()
    vi.mocked(createAdminClient).mockReturnValue({ from: mockFrom })

    // No eligible owners
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            lt: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                data: [],
                error: null,
              }),
            }),
          }),
        }),
      }),
    })

    const result = await evaluateDrips('welcome')
    expect(result).toHaveProperty('sent')
    expect(result).toHaveProperty('skipped')
    expect(result).toHaveProperty('errors')
    expect(result.sent).toBe(0)
  })

  it('skips owners without explicit lifecycle consent', async () => {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const client = mockDripClient([])
    vi.mocked(createAdminClient).mockReturnValue(client)

    await expect(evaluateDrips('welcome')).resolves.toEqual({
      sent: 0,
      skipped: 1,
      errors: 0,
    })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('removes the deduplication record when delivery fails', async () => {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const client = mockDripClient(['u1'])
    vi.mocked(createAdminClient).mockReturnValue(client)
    vi.mocked(sendEmail).mockResolvedValueOnce({
      success: false,
      error: 'provider unavailable',
    })

    await expect(evaluateDrips('welcome')).resolves.toEqual({
      sent: 0,
      skipped: 0,
      errors: 1,
    })
    expect(client.deleteRows).toHaveBeenCalledOnce()
  })
})
