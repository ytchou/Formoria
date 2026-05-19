import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

describe('brand-owners service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getUserBrands', () => {
    it('returns brands owned by the user', async () => {
      const { getUserBrands } = await import('./brand-owners')

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [
              {
                brand_id: 'brand-1',
                claimed_at: '2026-05-19T00:00:00Z',
                brands: {
                  id: 'brand-1',
                  name: 'Dachun Soap',
                  slug: 'dachun-soap',
                  logo_url: null,
                },
              },
            ],
            error: null,
          }),
        }),
      })

      const result = await getUserBrands('user-1')
      expect(result).toHaveLength(1)
      expect(result[0].brandId).toBe('brand-1')
      expect(result[0].brandName).toBe('Dachun Soap')
      expect(result[0].brandSlug).toBe('dachun-soap')
    })

    it('returns empty array when user owns no brands', async () => {
      const { getUserBrands } = await import('./brand-owners')

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
        }),
      })

      const result = await getUserBrands('user-1')
      expect(result).toEqual([])
    })
  })

  describe('isOwnerOf', () => {
    it('returns true when user owns the brand', async () => {
      const { isOwnerOf } = await import('./brand-owners')

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'record-1' },
                error: null,
              }),
            }),
          }),
        }),
      })

      const result = await isOwnerOf('user-1', 'brand-1')
      expect(result).toBe(true)
    })

    it('returns false when user does not own the brand', async () => {
      const { isOwnerOf } = await import('./brand-owners')

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }),
        }),
      })

      const result = await isOwnerOf('user-1', 'brand-1')
      expect(result).toBe(false)
    })
  })
})
