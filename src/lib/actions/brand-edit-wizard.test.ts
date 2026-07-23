import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/auth/require-brand-editor', () => ({ requireBrandEditor: vi.fn() }))
vi.mock('@/lib/services/brands', () => ({
  BRAND_DRAFT_PROGRESS_KEY: '__wizardCompletedSteps',
  getBrandDraft: vi.fn(),
  saveDraft: vi.fn(),
}))
vi.mock('next/headers', () => ({ cookies: vi.fn(() => ({ getAll: () => [] })) }))

import { saveSectionDraftAction } from './brand-edit-wizard'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
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
      brand: {
        id: 'brand-id',
        slug: 'brand-slug',
        retailLocations: [],
      },
      user: { id: 'user-1' },
      owner: true,
      actingAdmin: false,
      configuredAdmin: false,
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
    expect(saveDraft).toHaveBeenCalledWith(
      'brand-id',
      expect.objectContaining({
        name: 'Test Brand',
        productType: 'fashion',
        __wizardCompletedSteps: [0],
      }),
    )
    expect(revalidatePath).toHaveBeenCalledWith(
      '/dashboard/brands/brand-slug',
    )
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
        __wizardCompletedSteps: [0],
      })
    )
  })

  it('preserves and extends saved wizard progress', async () => {
    vi.mocked(getBrandDraft).mockResolvedValue({
      name: 'Warmwood Living',
      __wizardCompletedSteps: [0, 1],
    })

    await saveSectionDraftAction('brand-id', 'brand-slug', 'links', {
      purchaseWebsite: 'https://warmwood.example',
    })

    expect(saveDraft).toHaveBeenCalledWith(
      'brand-id',
      expect.objectContaining({
        name: 'Warmwood Living',
        purchaseWebsite: 'https://warmwood.example',
        __wizardCompletedSteps: [0, 1, 2],
      }),
    )
  })

  it('stores reputation fields in the brand domain shape', async () => {
    vi.mocked(getBrandDraft).mockResolvedValue({ name: 'Warmwood Living' })

    const result = await saveSectionDraftAction(
      'brand-id',
      'brand-slug',
      'reputation',
      {
        reputationSummary: 'Featured by independent design publications.',
        reputationSources: [
          { url: 'https://example.com/warmwood-review' },
          { url: '' },
        ],
      },
    )

    expect(result).toEqual({ success: true })
    expect(saveDraft).toHaveBeenCalledWith(
      'brand-id',
      expect.objectContaining({
        name: 'Warmwood Living',
        reputationSummary: {
          text: 'Featured by independent design publications.',
          sources: [{ url: 'https://example.com/warmwood-review' }],
        },
      }),
    )
  })

  it('prevents an admin from introducing owner confirmation on any wizard step', async () => {
    vi.mocked(getBrandDraft).mockResolvedValue({ name: 'Warmwood Living' })
    vi.mocked(requireBrandEditor).mockResolvedValue({
      brand: {
        id: 'brand-id',
        slug: 'brand-slug',
        retailLocations: [],
      },
      user: { id: 'admin-1' },
      owner: false,
      actingAdmin: true,
      configuredAdmin: true,
    } as unknown as Awaited<ReturnType<typeof requireBrandEditor>>)

    await saveSectionDraftAction('brand-id', 'brand-slug', 'basicInfo', {
      name: 'Warmwood Living',
      retailLocations: [
        {
          kind: 'location',
          name: '台北旗艦店',
          relationshipType: 'brand_store',
          address: '台北市信義區市府路 45 號',
          confirmationStatus: 'owner_confirmed',
        },
      ],
    })

    expect(saveDraft).toHaveBeenCalledWith(
      'brand-id',
      expect.objectContaining({
        retailLocations: [
          expect.objectContaining({ confirmationStatus: 'unconfirmed' }),
        ],
      }),
    )
  })

  it('preserves an explicit retail location clear on non-location steps', async () => {
    vi.mocked(getBrandDraft).mockResolvedValue({
      name: 'Warmwood Living',
      retailLocations: [
        {
          kind: 'location',
          name: '台北旗艦店',
          relationshipType: 'brand_store',
          address: '台北市信義區市府路 45 號',
          confirmationStatus: 'owner_confirmed',
        },
      ],
    })

    await saveSectionDraftAction('brand-id', 'brand-slug', 'basicInfo', {
      name: 'Warmwood Living',
      retailLocations: [],
    })

    expect(saveDraft).toHaveBeenCalledWith(
      'brand-id',
      expect.objectContaining({ retailLocations: [] }),
    )
  })

  it('returns error when save fails', async () => {
    vi.mocked(getBrandDraft).mockResolvedValue(null)
    vi.mocked(saveDraft).mockRejectedValue(new Error('DB error'))

    const result = await saveSectionDraftAction('brand-id', 'brand-slug', 'basicInfo', { name: 'X', productType: 'food' })

    expect(result).toEqual({ error: expect.any(String) })
  })
})
