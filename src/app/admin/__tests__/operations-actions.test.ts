import { describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: vi.fn(() => ({
    get: vi.fn(() => null),
  })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'admin-1', email: 'admin@test.com' } },
        error: null,
      }),
    },
  })),
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'job-123',
              operation: 'clean-names',
              status: 'running',
              progress: { processed: 5, total: 10 },
            },
            error: null,
          }),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'job-123', status: 'pending' },
            error: null,
          }),
        })),
      })),
    })),
  })),
}))

vi.mock('@/lib/auth/admin-mode', () => ({
  isActingAsAdmin: vi.fn().mockResolvedValue(true),
}))

describe('curation server actions', () => {
  it('defines the consolidated curation operations', async () => {
    const mod = await import('../../api/admin/run-job/route')
    expect(mod.VALID_OPERATIONS).toEqual(['enrich'])
  })

  it('keeps deprecated curation operations out of the valid set', async () => {
    const mod = await import('../../api/admin/run-job/route')
    const validOperations = new Set<string>(mod.VALID_OPERATIONS)

    expect(mod.DEPRECATED_OPERATIONS).toEqual([
      'clean-names',
      'normalize-slugs',
      'detect-non-brands',
      'enrich-descriptions',
      'enrich-links',
      'enrich-images',
      'score-and-scrape',
      'set-visibility',
    ])
    expect(mod.DEPRECATED_OPERATIONS.every((operation) => !validOperations.has(operation))).toBe(true)
  })

  it('exports startCurationJobAction', async () => {
    const mod = await import('../operations/actions')
    expect(mod.startCurationJobAction).toBeDefined()
    expect(typeof mod.startCurationJobAction).toBe('function')
  })

  it('exports getCurationJobAction', async () => {
    const mod = await import('../operations/actions')
    expect(mod.getCurationJobAction).toBeDefined()
    expect(typeof mod.getCurationJobAction).toBe('function')
  })
})
