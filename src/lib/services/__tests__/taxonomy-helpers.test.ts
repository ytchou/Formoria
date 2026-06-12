import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSupabase = { from: vi.fn() }

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => mockSupabase),
}))

describe('getTagBySlug', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns a TaxonomyTag when slug exists', async () => {
    const mockRow = {
      id: 'tag-1', name: 'Taipei', name_zh: '台北市',
      slug: 'taipei', category: 'region', is_active: true,
      suggested_by: null, created_at: '2026-01-01T00:00:00Z',
    }
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
        }),
      }),
    })

    const { getTagBySlug } = await import('../taxonomy')
    const result = await getTagBySlug('taipei')
    expect(result).not.toBeNull()
    expect(result!.slug).toBe('taipei')
  })

  it('returns null when slug does not exist', async () => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    })

    const { getTagBySlug } = await import('../taxonomy')
    const result = await getTagBySlug('nonexistent')
    expect(result).toBeNull()
  })
})

describe('updateBrandCategoryTags', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('replaces only tags in the specified category', async () => {
    const mockDeleteIn = vi.fn().mockResolvedValue({ error: null })
    const mockDeleteEq = vi.fn().mockReturnValue({ in: mockDeleteIn })
    const mockInsert = vi.fn().mockResolvedValue({ error: null })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'brand_taxonomy') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: [{ tag_id: 'old-region-tag' }], error: null,
              }),
            }),
          }),
          delete: vi.fn().mockReturnValue({ eq: mockDeleteEq }),
          insert: mockInsert,
        }
      }
      return {}
    })

    const { updateBrandCategoryTags } = await import('../taxonomy')
    await updateBrandCategoryTags('brand-1', 'region', ['new-region-tag'])

    expect(mockDeleteIn).toHaveBeenCalledWith('tag_id', ['old-region-tag'])
    expect(mockInsert).toHaveBeenCalledWith([{ brand_id: 'brand-1', tag_id: 'new-region-tag' }])
  })
})
