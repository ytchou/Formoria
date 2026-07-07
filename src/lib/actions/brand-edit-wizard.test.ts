import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/auth/require-brand-editor', () => ({ requireBrandEditor: vi.fn() }))
vi.mock('@/lib/services/brands', () => ({
  getBrandDraft: vi.fn(),
  saveDraft: vi.fn(),
}))
vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ getAll: () => [] })) }))

import { saveSectionDraftAction } from './brand-edit-wizard'
import { createClient } from '@/lib/supabase/server'
import { requireBrandEditor } from '@/lib/auth/require-brand-editor'
import { getBrandDraft, saveDraft } from '@/lib/services/brands'

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
    vi.mocked(requireBrandEditor).mockResolvedValue({
      brand: { id: 'brand-id', slug: 'brand-slug' },
      user: { id: 'user-1' },
    } as unknown as Awaited<ReturnType<typeof requireBrandEditor>>)
    vi.mocked(saveDraft).mockResolvedValue(undefined)
  })

  it('saves draft and returns success', async () => {
    vi.mocked(getBrandDraft).mockResolvedValue(null)

    const result = await saveSectionDraftAction('brand-id', 'brand-slug', 'basicInfo', {
      name: 'Test Brand',
      productType: 'fashion',
    })

    expect(result).toEqual({ success: true })
    expect(saveDraft).toHaveBeenCalled()
  })

  it('merges section data into existing draft', async () => {
    vi.mocked(getBrandDraft).mockResolvedValue({
      name: 'Old Name',
      heroImageUrl: 'http://example.com/img.jpg',
    })

    const result = await saveSectionDraftAction('brand-id', 'brand-slug', 'basicInfo', {
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

  it('returns error when save fails', async () => {
    vi.mocked(getBrandDraft).mockResolvedValue(null)
    vi.mocked(saveDraft).mockRejectedValue(new Error('DB error'))

    const result = await saveSectionDraftAction('brand-id', 'brand-slug', 'basicInfo', { name: 'X', productType: 'food' })

    expect(result).toEqual({ error: expect.any(String) })
  })
})
