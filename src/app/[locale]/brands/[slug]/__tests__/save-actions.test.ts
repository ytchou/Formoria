import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetUser } = vi.hoisted(() => {
  const mockGetUser = vi.fn()
  return { mockGetUser }
})

vi.mock('@/lib/services/saved-brands', () => ({
  isBrandSaved: vi.fn(),
  saveBrand: vi.fn(),
  unsaveBrand: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({ auth: { getUser: mockGetUser } }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { toggleSaveAction } from '@/lib/actions/saved-brands'
import { isBrandSaved, saveBrand, unsaveBrand } from '@/lib/services/saved-brands'

describe('toggleSaveAction', () => {
  const brandId = 'brand-123'
  const userId = 'user-456'

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    })
  })

  it('saves a brand when not already saved', async () => {
    vi.mocked(isBrandSaved).mockResolvedValue(false)
    vi.mocked(saveBrand).mockResolvedValue(undefined)

    const result = await toggleSaveAction(brandId)

    expect(saveBrand).toHaveBeenCalledWith(userId, brandId)
    expect(unsaveBrand).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, saved: true })
  })

  it('unsaves a brand when already saved', async () => {
    vi.mocked(isBrandSaved).mockResolvedValue(true)
    vi.mocked(unsaveBrand).mockResolvedValue(undefined)

    const result = await toggleSaveAction(brandId)

    expect(unsaveBrand).toHaveBeenCalledWith(userId, brandId)
    expect(saveBrand).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: true, saved: false })
  })

  it('returns error when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'not authenticated' },
    })

    const result = await toggleSaveAction(brandId)

    expect(result).toEqual({ error: expect.any(String) })
    expect(saveBrand).not.toHaveBeenCalled()
    expect(unsaveBrand).not.toHaveBeenCalled()
  })
})
