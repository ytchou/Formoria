import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
const mockRpc = vi.fn()
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom, rpc: mockRpc })),
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
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  brand_id: 'brand-1',
                  claimed_at: '2026-05-19T00:00:00Z',
                  brands: {
                    id: 'brand-1',
                    name: 'Dachun Soap',
                    slug: 'dachun-soap',
                  },
                },
              ],
              error: null,
            }),
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
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
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

  describe('revokeOwnership', () => {
    it('calls the revoke_brand_ownership RPC and returns the revoked owner', async () => {
      const { revokeOwnership } = await import('./brand-owners')

      mockRpc.mockResolvedValueOnce({
        data: [{ revoked_user_id: 'user-uuid-9', revoked_user_email: 'owner@haoshan-tea.tw' }],
        error: null,
      })

      const result = await revokeOwnership(
        'brand-uuid-123',
        'admin@formoria.tw',
        'Dispute upheld'
      )

      expect(mockRpc).toHaveBeenCalledWith('revoke_brand_ownership', {
        p_brand_id: 'brand-uuid-123',
        p_revoked_by: 'admin@formoria.tw',
        p_reason: 'Dispute upheld',
      })
      expect(result).toEqual({ userId: 'user-uuid-9', email: 'owner@haoshan-tea.tw' })
    })

    it('maps the NO_OWNER exception to an error result', async () => {
      const { revokeOwnership } = await import('./brand-owners')

      mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'NO_OWNER' } })

      await expect(
        revokeOwnership('brand-uuid-123', 'admin@formoria.tw', 'x')
      ).rejects.toThrow(/NO_OWNER/)
    })
  })
})
