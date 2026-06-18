/**
 * Unit test: getBrands() query construction for category and tag filtering.
 *
 * Verifies that getBrands() uses .in('product_type', ...) for category filtering
 * and .overlaps('tag_slugs', ...) for tag filtering, and that no !inner join
 * appears in the select string.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock must be at top level before any imports that use the module
vi.mock('@/lib/supabase/server')

import { createServiceClient } from '@/lib/supabase/server'
import { getBrands } from '../brands'

function createMockChain(options?: { count?: number }) {
  const chain: Record<string, unknown> = {}
  const methods = [
    'select', 'eq', 'or', 'not', 'contains', 'overlaps', 'in',
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

describe('getBrands — category and tag filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses .in(product_type) for category and .overlaps(tag_slugs) for tags when combined', async () => {
    const chain = createMockChain()
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn(() => chain),
    } as unknown as ReturnType<typeof createServiceClient>)

    await getBrands({ status: 'approved', category: ['food'], tags: ['handmade'] })

    expect(chain.in).toHaveBeenCalledWith('product_type', ['food'])
    expect(chain.overlaps).toHaveBeenCalledWith('tag_slugs', ['handmade'])
  })

  it('does not use !inner join in the select string', async () => {
    const chain = createMockChain()
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn(() => chain),
    } as unknown as ReturnType<typeof createServiceClient>)

    await getBrands({ status: 'approved', category: ['food'], tags: ['handmade'] })

    expect(chain.select).toHaveBeenCalledWith(
      expect.not.stringContaining('!inner'),
      expect.anything()
    )
  })

  it('uses .in(product_type) when only category is provided', async () => {
    const chain = createMockChain()
    vi.mocked(createServiceClient).mockReturnValue({
      from: vi.fn(() => chain),
    } as unknown as ReturnType<typeof createServiceClient>)

    await getBrands({ status: 'approved', category: ['food'] })

    expect(chain.in).toHaveBeenCalledWith('product_type', ['food'])
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
