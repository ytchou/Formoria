import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/services/brands', () => ({
  getBrandDraft: vi.fn(),
  saveDraft: vi.fn(),
}))
vi.mock('@/lib/services/pending-edits', () => ({
  createPendingEdit: vi.fn(),
  updatePendingEdit: vi.fn(),
}))
vi.mock('@/lib/services/brand-onboarding', () => ({
  completeOnboardingStepsForSection: vi.fn(),
}))
vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ getAll: () => [] })) }))

import { saveSectionDraftAction } from './brand-edit-wizard'
import { createClient } from '@/lib/supabase/server'
import { getBrandDraft, saveDraft } from '@/lib/services/brands'
import { createPendingEdit } from '@/lib/services/pending-edits'
import { completeOnboardingStepsForSection } from '@/lib/services/brand-onboarding'

const pendingEdit = { id: 'edit-1' } as Awaited<ReturnType<typeof createPendingEdit>>

describe('saveSectionDraftAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1' } },
          error: null,
        }),
      },
    } as unknown as Awaited<ReturnType<typeof createClient>>)
  })

  it('creates a new draft when none exists and returns success', async () => {
    vi.mocked(getBrandDraft).mockResolvedValue(null)
    vi.mocked(createPendingEdit).mockResolvedValue(pendingEdit)

    const result = await saveSectionDraftAction('brand-id', 'basicInfo', {
      name: 'Test Brand',
      productType: 'fashion',
    })

    expect(result).toEqual({ success: true })
    expect(createPendingEdit).toHaveBeenCalled()
  })

  it('merges section data into existing draft', async () => {
    vi.mocked(getBrandDraft).mockResolvedValue({
      name: 'Old Name',
      heroImageUrl: 'http://example.com/img.jpg',
    })

    const result = await saveSectionDraftAction('brand-id', 'basicInfo', {
      name: 'New Name',
      productType: 'food',
    })

    expect(result).toEqual({ success: true })
    expect(saveDraft).toHaveBeenCalledWith(
      'brand-id',
      expect.objectContaining({
        name: 'New Name',
        productType: 'food',
        heroImageUrl: 'http://example.com/img.jpg',
      })
    )
  })

  it('calls completeOnboardingStepsForSection for basicInfo', async () => {
    vi.mocked(getBrandDraft).mockResolvedValue(null)
    vi.mocked(createPendingEdit).mockResolvedValue(pendingEdit)

    await saveSectionDraftAction('brand-id', 'basicInfo', { name: 'X', productType: 'food' })

    expect(completeOnboardingStepsForSection).toHaveBeenCalledWith('brand-id', 'basicInfo')
  })

  it('does not call completeOnboardingStepsForSection for media', async () => {
    vi.mocked(getBrandDraft).mockResolvedValue(null)
    vi.mocked(createPendingEdit).mockResolvedValue(pendingEdit)

    await saveSectionDraftAction('brand-id', 'media', { heroImageUrl: 'http://example.com/img.jpg' })

    expect(completeOnboardingStepsForSection).not.toHaveBeenCalled()
  })

  it('returns error when save fails', async () => {
    vi.mocked(getBrandDraft).mockResolvedValue(null)
    vi.mocked(createPendingEdit).mockRejectedValue(new Error('DB error'))

    const result = await saveSectionDraftAction('brand-id', 'basicInfo', { name: 'X', productType: 'food' })

    expect(result).toEqual({ error: expect.any(String) })
  })
})
