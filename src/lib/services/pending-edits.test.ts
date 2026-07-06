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
  pendingEditWithBrandToDomain,
} from './pending-edits'
import { diffRemovedImageUrls, updateBrand } from './brands'
import { deleteBrandImages } from './image-upload'

const BRAND_ID = 'brand-uuid-1'
const USER_ID = 'user-uuid-1'
const EDIT_ID = 'edit-uuid-1'
const PROPOSED_DATA = { name: 'Updated Name', description: 'New description' }

function makePendingEditWithBrandRow(
  overrides: Partial<Parameters<typeof pendingEditWithBrandToDomain>[0]> = {},
): Parameters<typeof pendingEditWithBrandToDomain>[0] {
  return {
    id: EDIT_ID,
    brand_id: BRAND_ID,
    submitted_by: USER_ID,
    proposed_data: {},
    status: 'pending',
    reviewer_notes: null,
    reviewed_at: null,
    reviewed_by: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    brands: {
      id: BRAND_ID,
      name: 'Test Brand',
      slug: 'test-brand',
      description: null,
      hero_image_url: null,
      product_type: null,
      contact_email: null,
      founding_year: null,
      social_instagram: null,
      social_threads: null,
      social_facebook: null,
      purchase_website: null,
      purchase_pinkoi: null,
      purchase_shopee: null,
      other_urls: null,
      retail_locations: null,
      site_content: null,
      price_range: null,
      product_tags: null,
      mit_story: null,
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(updateBrand).mockResolvedValue({
    id: 'brand-1',
    name: 'Test Brand',
  } as Awaited<ReturnType<typeof updateBrand>>)
  vi.mocked(diffRemovedImageUrls).mockReturnValue([])
})

describe('createPendingEdit', () => {
  it('inserts a new pending edit when none exists', async () => {
    const checkChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    }
    const insertChain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: EDIT_ID, brand_id: BRAND_ID, status: 'pending' },
        error: null,
      }),
    }
    mockFrom.mockReturnValueOnce(checkChain).mockReturnValueOnce(insertChain)

    const result = await createPendingEdit(BRAND_ID, USER_ID, PROPOSED_DATA)

    expect(mockFrom).toHaveBeenCalledTimes(2)
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        brand_id: BRAND_ID,
        submitted_by: USER_ID,
        proposed_data: PROPOSED_DATA,
        status: 'pending',
      }),
    )
    expect(result.status).toBe('pending')
  })

  it('updates the existing pending edit when one exists', async () => {
    const checkChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: EDIT_ID } }),
    }
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: EDIT_ID, brand_id: BRAND_ID, status: 'pending' },
        error: null,
      }),
    }
    mockFrom.mockReturnValueOnce(checkChain).mockReturnValueOnce(updateChain)

    const result = await createPendingEdit(BRAND_ID, USER_ID, PROPOSED_DATA)

    expect(mockFrom).toHaveBeenCalledTimes(2)
    expect(updateChain.update).toHaveBeenCalled()
    expect(result.status).toBe('pending')
  })
})

describe('getPendingEdits', () => {
  it('returns all pending edits with brand info', async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          { id: EDIT_ID, status: 'pending', brands: { name: 'Test Brand' } },
        ],
        error: null,
      }),
    }
    mockFrom.mockReturnValue(mockChain)

    const result = await getPendingEdits('pending')
    expect(mockChain.select).toHaveBeenCalledWith(
      expect.stringContaining('description'),
    )
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('pending')
  })
})

describe('pendingEditWithBrandToDomain', () => {
  it('includes mitStory on the brand field of the mapped pending edit', () => {
    const rawEdit = makePendingEditWithBrandRow({
      brands: { mit_story: 'Handcrafted in New Taipei.' },
    })
    const mapped = pendingEditWithBrandToDomain(rawEdit)
    expect(mapped.brand.mitStory).toBe('Handcrafted in New Taipei.')
  })

  it('defaults brand.mitStory to null when mit_story absent', () => {
    const rawEdit = makePendingEditWithBrandRow({
      brands: { mit_story: null },
    })
    const mapped = pendingEditWithBrandToDomain(rawEdit)
    expect(mapped.brand.mitStory).toBeNull()
  })
})

describe('approvePendingEdit', () => {
  it('sets status to approved with CAS before updating the brand', async () => {
    const currentHero =
      'https://example.test/storage/v1/object/public/brand-images/brands/old-hero.png'
    const updatedHero =
      'https://example.test/storage/v1/object/public/brand-images/brands/new-hero.png'
    vi.mocked(updateBrand).mockResolvedValueOnce({
      id: BRAND_ID,
      name: 'Updated Name',
      slug: 'test-brand',
      heroImageUrl: updatedHero,
      productPhotos: [],
    } as unknown as Awaited<ReturnType<typeof updateBrand>>)
    vi.mocked(diffRemovedImageUrls).mockReturnValueOnce([currentHero])

    const mockUpdate = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: EDIT_ID,
          brand_id: BRAND_ID,
          proposed_data: { ...PROPOSED_DATA, heroImageUrl: updatedHero },
          status: 'approved',
          brands: {
            id: BRAND_ID,
            name: 'Test Brand',
            slug: 'test-brand',
            hero_image_url: currentHero,
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
      expect.objectContaining({ count: 'exact' }),
    )
    expect(mockUpdate.eq).toHaveBeenCalledWith('id', EDIT_ID)
    expect(mockUpdate.eq).toHaveBeenCalledWith('status', 'pending')
    expect(updateBrand).toHaveBeenCalledWith(
      BRAND_ID,
      expect.objectContaining({ ...PROPOSED_DATA, heroImageUrl: updatedHero }),
    )
    expect(diffRemovedImageUrls).toHaveBeenCalledWith(
      [currentHero],
      [updatedHero],
    )
    expect(deleteBrandImages).toHaveBeenCalledWith([currentHero])
  })

  it('throws when the edit was already processed', async () => {
    const mockUpdate = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        count: 0,
        error: { code: 'PGRST116' },
      }),
    }
    mockFrom.mockReturnValue(mockUpdate)

    await expect(approvePendingEdit(EDIT_ID, USER_ID)).rejects.toThrow(
      'already processed',
    )
    expect(updateBrand).not.toHaveBeenCalled()
  })

  it('throws when the brand update fails after approval', async () => {
    const updateError = new Error('update failed')
    vi.mocked(updateBrand).mockRejectedValueOnce(updateError)
    const mockUpdate = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: EDIT_ID,
          brand_id: BRAND_ID,
          proposed_data: PROPOSED_DATA,
          brands: null,
        },
        count: 1,
        error: null,
      }),
    }
    mockFrom.mockReturnValue(mockUpdate)

    await expect(approvePendingEdit(EDIT_ID, USER_ID)).rejects.toThrow(
      updateError,
    )
    expect(deleteBrandImages).not.toHaveBeenCalled()
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
      }),
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
      single: vi
        .fn()
        .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
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
