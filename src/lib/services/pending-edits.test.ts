import { beforeEach, describe, it, expect, vi } from 'vitest'

const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(() => mockSupabase),
}))
vi.mock('@/lib/services/brands', () => ({
  diffRemovedImageUrls: vi.fn(() => []),
  updateBrand: vi.fn().mockResolvedValue({ id: 'brand-1', name: 'Test Brand' }),
}))
vi.mock('@/lib/services/image-upload', () => ({
  deleteBrandImages: vi.fn().mockResolvedValue(undefined),
}))

import {
  createPendingEdit,
  getPendingEdits,
  approvePendingEdit,
  getPendingEditForReview,
  rejectPendingEdit,
  hasPendingEdit,
  getLatestEditReview,
} from './pending-edits'
import { diffRemovedImageUrls, updateBrand } from './brands'
import { deleteBrandImages } from './image-upload'

const BRAND_ID = 'brand-uuid-1'
const USER_ID = 'user-uuid-1'
const EDIT_ID = 'edit-uuid-1'
const PROPOSED_DATA = { name: 'Updated Name', description: 'New description' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(updateBrand).mockResolvedValue({ id: 'brand-1', name: 'Test Brand' } as Awaited<ReturnType<typeof updateBrand>>)
  vi.mocked(diffRemovedImageUrls).mockReturnValue([])
})

describe('createPendingEdit', () => {
  it('upserts a pending edit row for the brand', async () => {
    const mockChain = {
      upsert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: EDIT_ID, brand_id: BRAND_ID, status: 'pending' },
        error: null,
      }),
    }
    mockFrom.mockReturnValue(mockChain)

    const result = await createPendingEdit(BRAND_ID, USER_ID, PROPOSED_DATA)

    expect(mockFrom).toHaveBeenCalledWith('pending_brand_edits')
    expect(mockChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_id: BRAND_ID,
        submitted_by: USER_ID,
        proposed_data: PROPOSED_DATA,
        status: 'pending',
      }),
      expect.objectContaining({ onConflict: expect.any(String) })
    )
    expect(result.status).toBe('pending')
  })
})

describe('getPendingEdits', () => {
  it('returns all pending edits with brand info', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: EDIT_ID, status: 'pending', brands: { name: 'Test Brand' } }],
        error: null,
      }),
    }
    mockFrom.mockReturnValue(mockChain)

    const result = await getPendingEdits('pending')
    expect(mockChain.select).toHaveBeenCalledWith(expect.stringContaining('description'))
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('pending')
  })
})

describe('approvePendingEdit', () => {
  it('sets status to approved with CAS before updating the brand', async () => {
    const currentLogo = 'https://example.test/storage/v1/object/public/brand-images/brands/old-logo.png'
    const updatedLogo = 'https://example.test/storage/v1/object/public/brand-images/brands/new-logo.png'
    vi.mocked(updateBrand).mockResolvedValueOnce({
      id: BRAND_ID,
      name: 'Updated Name',
      slug: 'test-brand',
      logoUrl: updatedLogo,
      heroImageUrl: null,
      productPhotos: [],
    } as unknown as Awaited<ReturnType<typeof updateBrand>>)
    vi.mocked(diffRemovedImageUrls).mockReturnValueOnce([currentLogo])

    const mockUpdate = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: EDIT_ID,
          brand_id: BRAND_ID,
          proposed_data: { ...PROPOSED_DATA, logoUrl: updatedLogo },
          status: 'approved',
          brands: {
            id: BRAND_ID,
            name: 'Test Brand',
            slug: 'test-brand',
            logo_url: currentLogo,
            hero_image_url: null,
            product_photos: [],
          },
        },
        count: 1,
        error: null,
      }),
    }
    mockFrom.mockReturnValue(mockUpdate)

    await approvePendingEdit(EDIT_ID, USER_ID)

    expect(mockUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', reviewed_by: USER_ID }),
      expect.objectContaining({ count: 'exact' })
    )
    expect(mockUpdate.eq).toHaveBeenCalledWith('id', EDIT_ID)
    expect(mockUpdate.eq).toHaveBeenCalledWith('status', 'pending')
    expect(updateBrand).toHaveBeenCalledWith(
      BRAND_ID,
      expect.objectContaining({ ...PROPOSED_DATA, logoUrl: updatedLogo })
    )
    expect(diffRemovedImageUrls).toHaveBeenCalledWith([currentLogo], [updatedLogo])
    expect(deleteBrandImages).toHaveBeenCalledWith([currentLogo])
  })

  it('throws when the edit was already processed', async () => {
    const mockUpdate = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, count: 0, error: { code: 'PGRST116' } }),
    }
    mockFrom.mockReturnValue(mockUpdate)

    await expect(approvePendingEdit(EDIT_ID, USER_ID)).rejects.toThrow('already processed')
    expect(updateBrand).not.toHaveBeenCalled()
  })

  it('logs but does not throw when the brand update fails after approval', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(updateBrand).mockRejectedValueOnce(new Error('update failed'))
    const mockUpdate = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: EDIT_ID, brand_id: BRAND_ID, proposed_data: PROPOSED_DATA, brands: null },
        count: 1,
        error: null,
      }),
    }
    mockFrom.mockReturnValue(mockUpdate)

    await expect(approvePendingEdit(EDIT_ID, USER_ID)).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

describe('getPendingEditForReview', () => {
  it('returns brand context for admin review emails', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { brand_id: BRAND_ID, brands: { name: 'Test Brand' } },
        error: null,
      }),
    }
    mockFrom.mockReturnValue(mockChain)

    const result = await getPendingEditForReview(EDIT_ID)

    expect(mockChain.select).toHaveBeenCalledWith('brand_id, brands(name)')
    expect(result).toEqual({ brandId: BRAND_ID, brandName: 'Test Brand' })
  })
})

describe('rejectPendingEdit', () => {
  it('sets status to rejected with reviewer_notes', async () => {
    const mockChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    mockFrom.mockReturnValue(mockChain)

    await rejectPendingEdit(EDIT_ID, USER_ID, 'Please fix the description')

    expect(mockChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rejected',
        reviewer_notes: 'Please fix the description',
        reviewed_by: USER_ID,
      })
    )
  })
})

describe('hasPendingEdit', () => {
  it('returns true when a pending edit exists for the brand', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: EDIT_ID }, error: null }),
    }
    mockFrom.mockReturnValue(mockChain)

    const result = await hasPendingEdit(BRAND_ID)
    expect(result).toBe(true)
  })

  it('returns false when no pending edit exists', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
    }
    mockFrom.mockReturnValue(mockChain)

    const result = await hasPendingEdit(BRAND_ID)
    expect(result).toBe(false)
  })
})

describe('getLatestEditReview', () => {
  it('returns the most recent edit for brand+user', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: EDIT_ID, status: 'rejected', reviewer_notes: 'Fix it' },
        error: null,
      }),
    }
    mockFrom.mockReturnValue(mockChain)

    const result = await getLatestEditReview(BRAND_ID, USER_ID)
    expect(result?.status).toBe('rejected')
    expect(result?.reviewerNotes).toBe('Fix it')
  })
})
