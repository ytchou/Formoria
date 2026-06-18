import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
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
})
