import { describe, it, expect, vi } from 'vitest'

const mockFrom = vi.fn()
const mockSupabase = { from: mockFrom }
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(() => mockSupabase),
}))
vi.mock('@/lib/services/brands', () => ({
  updateBrand: vi.fn().mockResolvedValue({ id: 'brand-1', name: 'Test Brand' }),
}))

import {
  createPendingEdit,
  getPendingEdits,
  approvePendingEdit,
  rejectPendingEdit,
  hasPendingEdit,
  getLatestEditReview,
} from './pending-edits'
import { updateBrand } from './brands'

const BRAND_ID = 'brand-uuid-1'
const USER_ID = 'user-uuid-1'
const EDIT_ID = 'edit-uuid-1'
const PROPOSED_DATA = { name: 'Updated Name', description: 'New description' }

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
    expect(result).toHaveLength(1)
    expect(result[0].status).toBe('pending')
  })
})

describe('approvePendingEdit', () => {
  it('calls updateBrand with proposed_data and sets status to approved', async () => {
    const mockSelect = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: EDIT_ID, brand_id: BRAND_ID, proposed_data: PROPOSED_DATA, status: 'pending' },
        error: null,
      }),
    }
    const mockUpdate = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    mockFrom
      .mockReturnValueOnce(mockSelect)
      .mockReturnValueOnce(mockUpdate)

    await approvePendingEdit(EDIT_ID, USER_ID)

    expect(updateBrand).toHaveBeenCalledWith(BRAND_ID, expect.objectContaining(PROPOSED_DATA))
    expect(mockUpdate.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', reviewed_by: USER_ID })
    )
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
