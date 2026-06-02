import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkContent } from './moderation'

// ---------------------------------------------------------------------------
// Mocks for Supabase — declared at top level to avoid hoisting issues
// ---------------------------------------------------------------------------

const mockInsert = vi.fn()
const mockSelect = vi.fn()

const mockFrom = vi.fn(() => ({
  insert: mockInsert,
  select: mockSelect,
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

// ---------------------------------------------------------------------------
// Tests for createModerationFlags
// ---------------------------------------------------------------------------

describe('createModerationFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts records and returns mapped domain objects (happy path)', async () => {
    const { createModerationFlags } = await import('./moderation')

    const fakeRow = {
      id: 'flag-1',
      brand_id: 'brand-1',
      user_id: 'user-1',
      field_name: 'description',
      flagged_content: 'spammy text',
      previous_content: 'original text',
      flag_reason: 'excessive URLs',
      tier: 'flag',
      status: 'pending',
      reviewed_at: null,
      created_at: '2026-06-02T00:00:00Z',
      brands: { name: 'My Brand', slug: 'my-brand' },
    }

    mockInsert.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [fakeRow], error: null }),
    })

    const result = await createModerationFlags([
      {
        brandId: 'brand-1',
        userId: 'user-1',
        fieldName: 'description',
        flaggedContent: 'spammy text',
        previousContent: 'original text',
        flagReason: 'excessive URLs',
        tier: 'flag',
        status: 'pending',
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('flag-1')
    expect(result[0].brandId).toBe('brand-1')
    expect(result[0].fieldName).toBe('description')
    expect(result[0].flaggedContent).toBe('spammy text')
    expect(result[0].brandName).toBe('My Brand')
    expect(result[0].brandSlug).toBe('my-brand')
  })

  it('throws when the insert returns an error (edge case)', async () => {
    const { createModerationFlags } = await import('./moderation')

    mockInsert.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: new Error('DB error') }),
    })

    await expect(
      createModerationFlags([
        {
          brandId: 'b',
          userId: 'u',
          fieldName: 'name',
          flaggedContent: 'x',
          previousContent: null,
          flagReason: 'test',
          tier: 'flag',
          status: 'pending',
        },
      ])
    ).rejects.toThrow('DB error')
  })
})

// ---------------------------------------------------------------------------
// Tests for getModerationFlag
// ---------------------------------------------------------------------------

describe('getModerationFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a mapped domain object when the flag exists (happy path)', async () => {
    const { getModerationFlag } = await import('./moderation')

    const fakeRow = {
      id: 'flag-2',
      brand_id: 'brand-2',
      user_id: 'user-2',
      field_name: 'name',
      flagged_content: 'spam name',
      previous_content: null,
      flag_reason: 'spam',
      tier: 'flag',
      status: 'pending',
      reviewed_at: null,
      created_at: '2026-06-02T00:00:00Z',
      brands: null,
    }

    mockFrom.mockReturnValue({
      insert: mockInsert,
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: fakeRow, error: null }),
        }),
      }),
    })

    const result = await getModerationFlag('flag-2')

    expect(result).not.toBeNull()
    expect(result?.id).toBe('flag-2')
    expect(result?.brandId).toBe('brand-2')
    expect(result?.fieldName).toBe('name')
    expect(result?.brandName).toBeNull()
    expect(result?.previousContent).toBeNull()
  })

  it('returns null when flag is not found (edge case — PGRST116)', async () => {
    const { getModerationFlag } = await import('./moderation')

    mockFrom.mockReturnValue({
      insert: mockInsert,
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116', message: 'No rows found' },
          }),
        }),
      }),
    })

    const result = await getModerationFlag('nonexistent')
    expect(result).toBeNull()
  })
})

// --- New Tier 1 pattern tests ---

describe('new Tier 1 patterns', () => {
  it('blocks SEO spam — "buy now"', () => {
    const result = checkContent({ description: 'buy now at our store' })
    expect(result.isBlocked).toBe(true)
    expect(result.blocked[0].field).toBe('description')
  })

  it('blocks SEO spam — "order today"', () => {
    const result = checkContent({ description: 'order today and save big' })
    expect(result.isBlocked).toBe(true)
  })

  it('blocks MLM language', () => {
    const result = checkContent({ description: 'join our downline and earn passive income' })
    expect(result.isBlocked).toBe(true)
  })

  it('blocks fake testimonials', () => {
    const result = checkContent({ description: 'guaranteed results or your money back' })
    expect(result.isBlocked).toBe(true)
  })

  it('blocks health fraud', () => {
    const result = checkContent({ name: 'Miracle Cure Tea' })
    expect(result.isBlocked).toBe(true)
  })

  it('blocks phishing language', () => {
    const result = checkContent({ description: 'click here to claim your prize' })
    expect(result.isBlocked).toBe(true)
  })

  it('does not block legitimate Taiwanese brand content', () => {
    const result = checkContent({
      name: 'Sunrise Ceramics',
      description: 'Hand-thrown pottery from Yingge, crafted since 1980. Buy online or visit our studio.',
    })
    // "Buy online" is not the same as "buy now" — should NOT block
    expect(result.isBlocked).toBe(false)
  })
})

// --- New Tier 2 heuristic tests ---

describe('new Tier 2 heuristics', () => {
  it('flags duplicate name and description', () => {
    const result = checkContent({ name: 'Sun Tea', description: 'Sun Tea' })
    expect(result.flagged.some(f => f.field === 'description' && f.reason.includes('duplicate'))).toBe(true)
  })

  it('flags very short description', () => {
    const result = checkContent({ description: 'Good tea' })
    expect(result.flagged.some(f => f.field === 'description' && f.reason.includes('short'))).toBe(true)
  })

  it('does not flag description at or above 20 chars', () => {
    const result = checkContent({ description: 'Quality leather goods.' }) // 22 chars
    expect(result.flagged.some(f => f.field === 'description')).toBe(false)
  })

  it('flags excessive emoji', () => {
    const result = checkContent({ description: '🌟✨🎉🔥💎🌈🎊🍀🌺🏆💫 amazing brand' })
    expect(result.flagged.some(f => f.field === 'description' && f.reason.includes('emoji'))).toBe(true)
  })

  it('flags suspicious TLD in websiteUrl', () => {
    const result = checkContent({ websiteUrl: 'https://brandname.tk' })
    expect(result.flagged.some(f => f.field === 'websiteUrl' && f.reason.includes('TLD'))).toBe(true)
  })

  it('does not flag legitimate .com URL', () => {
    const result = checkContent({ websiteUrl: 'https://brandname.com' })
    expect(result.flagged.some(f => f.field === 'websiteUrl')).toBe(false)
  })
})

describe('moderation service', () => {
  describe('checkContent', () => {
    it('returns clean result for normal content', () => {
      const result = checkContent({
        name: 'My Brand',
        description: 'We make handcrafted ceramics in Yingge.',
      })
      expect(result.blocked).toEqual([])
      expect(result.flagged).toEqual([])
      expect(result.isBlocked).toBe(false)
    })

    it('blocks content with Tier 1 terms', () => {
      const result = checkContent({
        description: 'Buy cheap viagra now!!!',
      })
      expect(result.isBlocked).toBe(true)
      expect(result.blocked.length).toBeGreaterThan(0)
      expect(result.blocked[0].field).toBe('description')
      expect(result.blocked[0].reason).toBeTruthy()
    })

    it('flags content with excessive URLs (Tier 2)', () => {
      const result = checkContent({
        description:
          'Visit http://a.com and http://b.com and http://c.com and http://d.com for deals',
      })
      expect(result.isBlocked).toBe(false)
      expect(result.flagged.length).toBeGreaterThan(0)
      expect(result.flagged[0].field).toBe('description')
      expect(result.flagged[0].tier).toBe('flag')
    })

    it('flags all-caps blocks (Tier 2)', () => {
      const result = checkContent({
        description: 'THIS IS ALL CAPS AND VERY LONG SHOUTING TEXT BLOCK HERE',
      })
      expect(result.isBlocked).toBe(false)
      expect(result.flagged.length).toBeGreaterThan(0)
    })

    it('checks multiple fields independently', () => {
      const result = checkContent({
        name: 'Normal Name',
        description: 'Buy cheap viagra now!!!',
      })
      expect(result.blocked.length).toBe(1)
      expect(result.blocked[0].field).toBe('description')
    })

    it('handles empty fields gracefully', () => {
      const result = checkContent({})
      expect(result.blocked).toEqual([])
      expect(result.flagged).toEqual([])
      expect(result.isBlocked).toBe(false)
    })

    it('returns both blocked and flagged results when both apply', () => {
      const result = checkContent({
        name: 'Buy cheap viagra',
        description:
          'Visit http://a.com http://b.com http://c.com http://d.com',
      })
      expect(result.blocked.length).toBeGreaterThan(0)
      expect(result.flagged.length).toBeGreaterThan(0)
      expect(result.isBlocked).toBe(true)
    })
  })
})
