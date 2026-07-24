import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createServiceClient } from '@/lib/supabase/server'
import { getBrandLikeState, setBrandLike } from '../brand-likes'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

type QueryResponse = {
  data?: unknown
  count?: number | null
  error: unknown
}

function makeBuilder(response: QueryResponse) {
  const builder = {
    ...response,
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => response),
    upsert: vi.fn(async () => response),
    delete: vi.fn(),
  }
  builder.select.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.delete.mockReturnValue(builder)
  return builder
}

function mockClient(...builders: ReturnType<typeof makeBuilder>[]) {
  const from = vi.fn()
  for (const builder of builders) from.mockReturnValueOnce(builder)
  vi.mocked(createServiceClient).mockReturnValue(
    { from } as unknown as ReturnType<typeof createServiceClient>,
  )
  return from
}

describe('brand-likes service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns an approved brand count and viewer reaction together', async () => {
    const approved = makeBuilder({ data: { id: 'brand-1' }, error: null })
    const count = makeBuilder({ count: 9, error: null })
    const viewerLike = makeBuilder({ data: { id: 'like-1' }, error: null })
    const from = mockClient(approved, count, viewerLike)

    await expect(getBrandLikeState('brand-1', 'a'.repeat(64))).resolves.toEqual({
      count: 9,
      liked: true,
    })
    expect(from).toHaveBeenNthCalledWith(1, 'brands')
    expect(from).toHaveBeenNthCalledWith(2, 'brand_likes')
    expect(from).toHaveBeenNthCalledWith(3, 'brand_likes')
  })

  it('sets the desired state idempotently before returning the count', async () => {
    const approved = makeBuilder({ data: { id: 'brand-1' }, error: null })
    const mutation = makeBuilder({ error: null })
    const count = makeBuilder({ count: 10, error: null })
    mockClient(approved, mutation, count)

    await expect(setBrandLike('brand-1', 'b'.repeat(64), true)).resolves.toEqual({
      count: 10,
      liked: true,
    })
    expect(mutation.upsert).toHaveBeenCalledWith(
      { brand_id: 'brand-1', visitor_hash: 'b'.repeat(64) },
      { onConflict: 'brand_id,visitor_hash', ignoreDuplicates: true },
    )
  })

  it('does not expose likes for a non-public brand', async () => {
    const hidden = makeBuilder({ data: null, error: null })
    const from = mockClient(hidden)

    await expect(getBrandLikeState('brand-1', null)).rejects.toThrow('Brand not found')
    expect(from).toHaveBeenCalledTimes(1)
  })
})
