import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock must be at top-level for vitest hoisting
const mockFrom = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

import {
  setBrandTags,
  addTagToBrand,
  removeTagFromBrand,
  getUntaggedBrands,
  getBrandsForReview,
  processSuggestedTag,
} from '../taxonomy'

// Build a chainable thenable proxy. Every property access returns a fn that returns another proxy.
// When awaited, the proxy resolves to resolveValue.
function makeChain(resolveValue: { data: unknown; error: unknown }) {
  function buildProxy(): object {
    return new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => resolve(resolveValue)
          }
          if (prop === Symbol.toPrimitive || prop === Symbol.iterator) return undefined
          return vi.fn(() => buildProxy())
        },
      }
    )
  }
  return buildProxy()
}

describe('setBrandTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes existing brand_taxonomy rows then inserts new ones', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }))

    await setBrandTags('brand-1', ['tag-1', 'tag-2'], 'manual')

    expect(mockFrom).toHaveBeenCalledWith('brand_taxonomy')
    // select (preflight) + delete + insert = 3 calls
    expect(mockFrom).toHaveBeenCalledTimes(3)
  })

  it('skips insert when tagIds is empty (untagging)', async () => {
    mockFrom.mockReturnValue(makeChain({ data: null, error: null }))

    await setBrandTags('brand-1', [], 'manual')

    // select (preflight) + delete = 2 calls; insert is skipped
    expect(mockFrom).toHaveBeenCalledTimes(2)
  })

  it('uses the provided source on all inserted rows', async () => {
    const insertedRows: unknown[] = []

    // Calls: 1=select (preflight), 2=delete, 3=insert
    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount <= 2) return makeChain({ data: null, error: null })
      // Third call: intercept insert
      const insertMock = vi.fn((rows: unknown[]) => {
        insertedRows.push(...rows)
        return makeChain({ data: null, error: null })
      })
      return { insert: insertMock }
    })

    await setBrandTags('brand-1', ['tag-a'], 'auto')

    expect(insertedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ brand_id: 'brand-1', tag_id: 'tag-a', source: 'auto' }),
      ])
    )
  })
})

describe('addTagToBrand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('upserts brand_taxonomy with correct fields', async () => {
    const upsertMock = vi.fn(() => makeChain({ data: null, error: null }))
    mockFrom.mockReturnValue({ upsert: upsertMock })

    await addTagToBrand('brand-1', 'tag-1', 'suggested')

    expect(mockFrom).toHaveBeenCalledWith('brand_taxonomy')
    expect(upsertMock).toHaveBeenCalledWith(
      { brand_id: 'brand-1', tag_id: 'tag-1', source: 'suggested' },
      { onConflict: 'brand_id,tag_id' }
    )
  })
})

describe('removeTagFromBrand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes from brand_taxonomy matching brand_id and tag_id', async () => {
    // Track the delete call
    const deleteMock = vi.fn(() => makeChain({ data: null, error: null }))
    mockFrom.mockReturnValue({ delete: deleteMock })

    await removeTagFromBrand('brand-1', 'tag-1')

    expect(mockFrom).toHaveBeenCalledWith('brand_taxonomy')
    expect(deleteMock).toHaveBeenCalled()
  })
})

describe('getUntaggedBrands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns an array of brands filtered from brand_taxonomy left join', async () => {
    // The implementation uses a left join and filters client-side for empty brand_taxonomy arrays
    const dbRows = [
      { id: 'b1', name: 'Brand One', slug: 'brand-one', category: 'Fashion', brand_taxonomy: [] },
      {
        id: 'b2',
        name: 'Brand Two',
        slug: 'brand-two',
        category: 'Food',
        brand_taxonomy: [{ brand_id: 'b2' }],
      }, // tagged — should be filtered out
    ]
    mockFrom.mockReturnValue(makeChain({ data: dbRows, error: null }))

    const result = await getUntaggedBrands()

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(1)
    expect(result[0]).toMatchObject({ id: 'b1', name: 'Brand One', slug: 'brand-one' })
  })

  it('returns empty array when no untagged brands', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [], error: null }))

    const result = await getUntaggedBrands()

    expect(result).toEqual([])
  })

  it('queries brands table', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [], error: null }))

    await getUntaggedBrands()

    expect(mockFrom).toHaveBeenCalledWith('brands')
  })
})

describe('getBrandsForReview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns brands with their tags', async () => {
    const dbRows = [
      {
        id: 'b1',
        name: 'Leather Studio',
        slug: 'leather-studio',
        brand_taxonomy: [
          {
            source: 'auto',
            taxonomy_tags: {
              id: 't1',
              name: 'Bags',
              name_zh: '包',
              slug: 'bags',
              category: 'product_type',
              is_active: true,
              suggested_by: null,
              created_at: '2026-01-01',
            },
          },
        ],
      },
    ]
    mockFrom.mockReturnValue(makeChain({ data: dbRows, error: null }))

    const result = await getBrandsForReview('auto')

    expect(result.length).toBe(1)
    expect(result[0].id).toBe('b1')
    expect(result[0].tags.length).toBe(1)
    expect(result[0].tags[0].id).toBe('t1')
  })

  it('queries brands table', async () => {
    mockFrom.mockReturnValue(makeChain({ data: [], error: null }))

    await getBrandsForReview('auto')

    expect(mockFrom).toHaveBeenCalledWith('brands')
  })
})

describe('processSuggestedTag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns early on reject action without DB calls', async () => {
    await processSuggestedTag('sub-1', 'reject')

    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('on map-existing: upserts into brand_taxonomy with targetTagId and suggested source', async () => {
    const upsertMock = vi.fn(() => makeChain({ data: null, error: null }))
    mockFrom.mockReturnValue({ upsert: upsertMock })

    await processSuggestedTag('sub-1', 'map-existing', 'target-tag-id')

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ tag_id: 'target-tag-id', source: 'suggested' }),
      expect.any(Object)
    )
  })

  it('on create-new: inserts a new tag then upserts into brand_taxonomy', async () => {
    const tagRow = {
      id: 'new-tag-id',
      name: 'New Tag',
      name_zh: null,
      slug: 'new-tag',
      category: 'product_type',
      is_active: true,
      suggested_by: null,
      created_at: '2026-01-01',
    }
    const insertMock = vi.fn(() => makeChain({ data: tagRow, error: null }))
    const upsertMock = vi.fn(() => makeChain({ data: null, error: null }))

    let callCount = 0
    mockFrom.mockImplementation(() => {
      callCount++
      if (callCount === 1) return { insert: insertMock }
      return { upsert: upsertMock }
    })

    await processSuggestedTag('sub-1', 'create-new', undefined, {
      name: 'New Tag',
      category: 'product_type' as const,
      brandId: 'brand-1',
    })

    expect(insertMock).toHaveBeenCalled()
    expect(upsertMock).toHaveBeenCalled()
  })
})
