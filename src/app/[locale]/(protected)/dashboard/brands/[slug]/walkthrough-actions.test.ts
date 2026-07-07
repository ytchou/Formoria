import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/auth/require-brand-editor', () => ({ requireBrandEditor: vi.fn() }))
vi.mock('@/lib/services/brand-onboarding', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/services/brand-onboarding')>(),
  setBrandOnboardingStepStatus: vi.fn(),
}))

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireBrandEditor } from '@/lib/auth/require-brand-editor'
import { setBrandOnboardingStepStatus } from '@/lib/services/brand-onboarding'
import { visitDashboardWalkthroughStep } from './walkthrough-actions'

describe('visitDashboardWalkthroughStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireBrandEditor).mockResolvedValue({
      brand: { id: 'brand-id' },
      user: { id: 'user-id' },
    } as Awaited<ReturnType<typeof requireBrandEditor>>)
  })

  it('marks the linked step visited before redirecting', async () => {
    await visitDashboardWalkthroughStep('brand-id', 'brand-slug', 'analytics')

    expect(setBrandOnboardingStepStatus).toHaveBeenCalledWith({
      brandId: 'brand-id',
      userId: 'user-id',
      step: 'analytics',
      status: 'complete',
    })
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/brands/brand-slug')
    expect(redirect).toHaveBeenCalledWith('/dashboard/brands/brand-slug/analytics')
  })
})
