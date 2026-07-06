import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  onboardingMaybeSingle: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'brand_owners') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: mocks.maybeSingle }),
          }),
        }
      }
      if (table === 'brand_onboarding_steps') {
        return {
          select: (cols: string) => {
            if (cols === 'step_key, status') {
              // getBrandOnboardingProgress: single .eq() awaited directly
              return { eq: mocks.eq }
            }
            // setBrandOnboardingStepStatus: .eq().eq().maybeSingle() read chain
            return {
              eq: () => ({
                eq: () => ({ maybeSingle: mocks.onboardingMaybeSingle }),
              }),
            }
          },
          upsert: mocks.upsert,
        }
      }
      return {
        select: () => ({ eq: mocks.eq }),
      }
    },
  }),
}))

import {
  buildOnboardingProgress,
  completeOnboardingStepsForSection,
  getBrandOnboardingProgress,
  ONBOARDING_STEPS,
  setBrandOnboardingStepStatus,
} from './brand-onboarding'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildOnboardingProgress', () => {
  it('starts every step incomplete when no progress exists', () => {
    const progress = buildOnboardingProgress([])

    expect(progress.completedCount).toBe(0)
    expect(progress.nextStep).toBe('brand_basics')
    expect(progress.steps.map((step) => step.key)).toEqual(ONBOARDING_STEPS)
    expect(progress.steps.every((step) => step.status === 'not_started')).toBe(true)
  })

  it('preserves explicit progress without inferring from brand fields', () => {
    const progress = buildOnboardingProgress([
      { step_key: 'brand_basics', status: 'complete' },
      { step_key: 'media_links', status: 'in_progress' },
    ])

    expect(progress.completedCount).toBe(1)
    expect(progress.nextStep).toBe('media_links')
    expect(progress.isComplete).toBe(false)
  })

  it('shows step one when the onboarding migration has not been applied yet', async () => {
    mocks.eq.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST205' },
    })

    const progress = await getBrandOnboardingProgress('brand-1')

    expect(progress.nextStep).toBe('brand_basics')
    expect(progress.completedCount).toBe(0)
  })
})

describe('setBrandOnboardingStepStatus', () => {
  it('skips persistence when the onboarding table is unavailable', async () => {
    mocks.onboardingMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST205' },
    })

    await expect(
      setBrandOnboardingStepStatus({ brandId: 'brand-1', userId: 'user-1', step: 'brand_basics', status: 'in_progress' })
    ).resolves.toBeUndefined()
  })
})

describe('completeOnboardingStepsForSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.maybeSingle.mockResolvedValue({ data: { user_id: 'user-1' }, error: null })
    mocks.onboardingMaybeSingle.mockResolvedValue({ data: null, error: null })
    mocks.upsert.mockResolvedValue({ error: null })
  })

  it('completes brand_basics when sectionKey is basicInfo', async () => {
    await completeOnboardingStepsForSection('test-brand-id', 'basicInfo')

    expect(mocks.upsert).toHaveBeenCalledTimes(1)
    const steps = mocks.upsert.mock.calls.map(
      (call: unknown[]) => (call[0] as Record<string, unknown>).step_key
    )
    expect(steps).toContain('brand_basics')
  })

  it('completes media_links when sectionKey is links', async () => {
    await completeOnboardingStepsForSection('test-brand-id', 'links')

    expect(mocks.upsert).toHaveBeenCalledTimes(1)
    const steps = mocks.upsert.mock.calls.map(
      (call: unknown[]) => (call[0] as Record<string, unknown>).step_key
    )
    expect(steps).toContain('media_links')
  })

  it('completes media_links when sectionKey is media', async () => {
    await completeOnboardingStepsForSection('test-brand-id', 'media')

    expect(mocks.upsert).toHaveBeenCalledTimes(1)
    const steps = mocks.upsert.mock.calls.map(
      (call: unknown[]) => (call[0] as Record<string, unknown>).step_key
    )
    expect(steps).toContain('media_links')
  })

  it('does nothing for sections with no onboarding steps (e.g. customerVoices)', async () => {
    await completeOnboardingStepsForSection('any-id', 'customerVoices')
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
