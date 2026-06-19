import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createServiceClient } from '@/lib/supabase/server'
import {
  getUserSavedBrandIds,
  getUserSavedBrands,
  isBrandSaved,
  saveBrand,
  unsaveBrand,
} from '../saved-brands'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}))

type QueryResponse = {
  data: unknown
  error: unknown
}

type QueryBuilder = QueryResponse & {
  from: ReturnType<typeof vi.fn>
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
  insert: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
}

function makeQueryBuilder(response: QueryResponse): QueryBuilder {
  const builder = {
    ...response,
  } as QueryBuilder

  builder.from = vi.fn(() => builder)
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn(async () => response)
  builder.insert = vi.fn(async () => response)
  builder.delete = vi.fn(() => builder)
  builder.upsert = vi.fn(async () => response)
  builder.maybeSingle = vi.fn(async () => response)

  return builder
}

function mockSupabase(response: QueryResponse): QueryBuilder {
  const builder = makeQueryBuilder(response)
  vi.mocked(createServiceClient).mockReturnValue(
    { from: builder.from } as unknown as ReturnType<typeof createServiceClient>
  )
  return builder
}

describe('saved-brands service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getUserSavedBrandIds', () => {
    it('returns string brand IDs for the user', async () => {
      const builder = mockSupabase({
        data: [{ brand_id: 'brand-1' }, { brand_id: 'brand-2' }],
        error: null,
      })

      await expect(getUserSavedBrandIds('user-1')).resolves.toEqual([
        'brand-1',
        'brand-2',
      ])
      expect(builder.from).toHaveBeenCalledWith('brand_saves')
      expect(builder.select).toHaveBeenCalledWith('brand_id')
      expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    })
  })

  describe('getUserSavedBrands', () => {
    it('returns approved saved brands with camelCase fields', async () => {
      const builder = mockSupabase({
        data: [
          {
            brand_id: 'brand-1',
            created_at: '2026-06-12T00:00:00Z',
            brands: {
              id: 'brand-1',
              name: 'Dachun Soap',
              slug: 'dachun-soap',
              hero_image_url: null,
              status: 'approved',
            },
          },
          {
            brand_id: 'brand-2',
            created_at: '2026-06-12T01:00:00Z',
            brands: {
              id: 'brand-2',
              name: 'Pending Brand',
              slug: 'pending-brand',
              hero_image_url: null,
              status: 'pending',
            },
          },
        ],
        error: null,
      })

      await expect(getUserSavedBrands('user-1')).resolves.toEqual([
        {
          brandId: 'brand-1',
          brandName: 'Dachun Soap',
          brandSlug: 'dachun-soap',
          heroImageUrl: null,
          savedAt: '2026-06-12T00:00:00Z',
        },
      ])
      expect(builder.from).toHaveBeenCalledWith('brand_saves')
      expect(builder.select).toHaveBeenCalledWith(
        'brand_id, created_at, brands(id, name, slug, hero_image_url, status)'
      )
      expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1')
    })
  })

  describe('saveBrand', () => {
    it('upserts the save with user and brand conflict handling', async () => {
      const builder = mockSupabase({ data: null, error: null })

      await expect(saveBrand('user-1', 'brand-1')).resolves.toBeUndefined()
      expect(builder.from).toHaveBeenCalledWith('brand_saves')
      expect(builder.upsert).toHaveBeenCalledWith(
        {
          user_id: 'user-1',
          brand_id: 'brand-1',
        },
        { onConflict: 'user_id,brand_id' }
      )
    })
  })

  describe('unsaveBrand', () => {
    it('deletes the matching save record', async () => {
      const builder = mockSupabase({ data: null, error: null })

      await expect(unsaveBrand('user-1', 'brand-1')).resolves.toBeUndefined()
      expect(builder.from).toHaveBeenCalledWith('brand_saves')
      expect(builder.delete).toHaveBeenCalled()
      expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1')
      expect(builder.eq).toHaveBeenCalledWith('brand_id', 'brand-1')
    })
  })

  describe('isBrandSaved', () => {
    it('returns true when maybeSingle finds a save', async () => {
      const builder = mockSupabase({
        data: { id: 'save-1' },
        error: null,
      })

      await expect(isBrandSaved('user-1', 'brand-1')).resolves.toBe(true)
      expect(builder.from).toHaveBeenCalledWith('brand_saves')
      expect(builder.select).toHaveBeenCalledWith('id')
      expect(builder.eq).toHaveBeenCalledWith('user_id', 'user-1')
      expect(builder.eq).toHaveBeenCalledWith('brand_id', 'brand-1')
      expect(builder.maybeSingle).toHaveBeenCalled()
    })

    it('returns false when maybeSingle finds no save', async () => {
      mockSupabase({
        data: null,
        error: null,
      })

      await expect(isBrandSaved('user-1', 'brand-1')).resolves.toBe(false)
    })
  })
})
