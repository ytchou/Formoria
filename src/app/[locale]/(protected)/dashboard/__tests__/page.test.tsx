// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  setRequestLocale: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'u1', email: 'test@example.com' } },
        error: null,
      }),
    },
  }),
}))
vi.mock('@/lib/services/brand-owners', () => ({
  getUserBrands: vi.fn(),
  getBrandBySlugForAdmin: vi.fn(),
}))

import { redirect } from 'next/navigation'
import { getUserBrands } from '@/lib/services/brand-owners'
import DashboardPage from '../page'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DashboardPage redirect', () => {
  it('redirects to the brand overview page when user owns a brand', async () => {
    vi.mocked(getUserBrands).mockResolvedValue([
      {
        brandId: 'b1',
        brandName: 'Test Brand',
        brandSlug: 'test-brand',
        heroImageUrl: null,
        claimedAt: '2026-01-01',
      },
    ])

    await DashboardPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    })

    expect(redirect).toHaveBeenCalledWith('/en/dashboard/brands/test-brand')
  })

  it('returns null when user has no brands', async () => {
    vi.mocked(getUserBrands).mockResolvedValue([])

    const result = await DashboardPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    })

    expect(result).toBeNull()
    expect(redirect).not.toHaveBeenCalled()
  })
})
