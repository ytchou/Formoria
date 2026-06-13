// Unit tests for findSimilarBrands — mocked Supabase client, no live DB required.
// For live DB integration, run with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Must be at top level before any imports that use the module (Vitest hoists vi.mock)
vi.mock('@/lib/supabase/server')

import { createServiceClient } from '@/lib/supabase/server'
import { describeWithDb } from '@/test/setup'
import { findSimilarBrands } from '@/lib/services/brands'

describe('findSimilarBrands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when no names provided', async () => {
    const result = await findSimilarBrands([])
    expect(result).toEqual([])
  })

  it('maps RPC response rows to SimilarBrand shape', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: [
        {
          input_name: 'Acme',
          brand_name: 'Acme Taiwan',
          brand_slug: 'acme-taiwan',
          similarity_score: 0.75,
        },
      ],
      error: null,
    })
    vi.mocked(createServiceClient).mockReturnValue({
      rpc: mockRpc,
    } as unknown as ReturnType<typeof createServiceClient>)

    const result = await findSimilarBrands(['Acme'])
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      inputName: 'Acme',
      brandName: 'Acme Taiwan',
      brandSlug: 'acme-taiwan',
      score: 0.75,
    })
    expect(mockRpc).toHaveBeenCalledWith('find_similar_brands', {
      p_names: ['Acme'],
      p_threshold: 0.3,
    })
  })

  it('throws when RPC returns an error', async () => {
    vi.mocked(createServiceClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'rpc failed' } }),
    } as unknown as ReturnType<typeof createServiceClient>)

    await expect(findSimilarBrands(['X'])).rejects.toThrow('findSimilarBrands: rpc failed')
  })

  it('returns empty array when RPC returns null data', async () => {
    vi.mocked(createServiceClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    } as unknown as ReturnType<typeof createServiceClient>)

    const result = await findSimilarBrands(['NoMatch'])
    expect(result).toEqual([])
  })
})

describeWithDb('findSimilarBrands (live DB integration)', () => {
  it('returns an array of SimilarBrand results against real DB', async () => {
    const result = await findSimilarBrands(['test'])
    expect(Array.isArray(result)).toBe(true)
    for (const item of result) {
      expect(item).toMatchObject({
        inputName: expect.any(String),
        brandName: expect.any(String),
        brandSlug: expect.any(String),
        score: expect.any(Number),
      })
      expect(item.score).toBeGreaterThanOrEqual(0.3)
    }
  })
})
