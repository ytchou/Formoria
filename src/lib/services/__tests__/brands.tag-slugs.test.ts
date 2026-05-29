/**
 * Unit test: getBrands() query construction for tag_slugs array-operator filtering.
 *
 * Verifies that the refactored getBrands() calls .contains() and .overlaps() on the
 * denormalized tag_slugs column instead of the old embedded-relation path, and that
 * no !inner join appears in the select string.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock must be at top level before any imports that use the module
vi.mock('@/lib/supabase/server')

import { createServiceClient } from '@/lib/supabase/server'
import { getBrands } from '../brands'

function createMockChain(options?: { count?: number }) {
  const chain: Record<string, unknown> = {}
  const methods = [
    'select', 'eq', 'or', 'contains', 'overlaps', 'in',
    'order', 'limit', 'range', 'single', 'maybeSingle',
  ]
  methods.forEach((m) => {
    chain[m] = vi.fn(() => chain)
  })
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({
      data: [],
      error: null,
      count: options?.count ?? 0,
    }).then(resolve)
  return chain
}

describe('getBrands — tag_slugs array-operator filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls .contains() and .overlaps() on tag_slugs when category + tags are combined', async () => {
    const chain = createMockChain()
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn(() => chain),
    } as unknown as ReturnType<typeof createServiceClient>)

    await getBrands({ status: 'approved', category: 'food', tags: ['handmade'] })

    expect(chain.contains).toHaveBeenCalledWith('tag_slugs', ['food'])
    expect(chain.overlaps).toHaveBeenCalledWith('tag_slugs', ['handmade'])
  })

  it('does not use !inner join in the select string', async () => {
    const chain = createMockChain()
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn(() => chain),
    } as unknown as ReturnType<typeof createServiceClient>)

    await getBrands({ status: 'approved', category: 'food', tags: ['handmade'] })

    expect(chain.select).toHaveBeenCalledWith(
      expect.not.stringContaining('!inner'),
      expect.anything()
    )
  })

  it('calls .contains() but not .overlaps() when only category is provided', async () => {
    const chain = createMockChain()
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn(() => chain),
    } as unknown as ReturnType<typeof createServiceClient>)

    await getBrands({ status: 'approved', category: 'food' })

    expect(chain.contains).toHaveBeenCalledWith('tag_slugs', ['food'])
    expect(chain.overlaps).not.toHaveBeenCalled()
  })

  it('calls .overlaps() but not .contains() when only tags are provided', async () => {
    const chain = createMockChain()
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn(() => chain),
    } as unknown as ReturnType<typeof createServiceClient>)

    await getBrands({ status: 'approved', tags: ['handmade', 'organic'] })

    expect(chain.overlaps).toHaveBeenCalledWith('tag_slugs', ['handmade', 'organic'])
    expect(chain.contains).not.toHaveBeenCalled()
  })
})
