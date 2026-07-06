import { describe, it, expect } from 'vitest'

describe('brand-onboarding actions — removed actions', () => {
  it('does not export startOnboardingStepAction', async () => {
    const mod = await import('./brand-onboarding')
    expect(mod).not.toHaveProperty('startOnboardingStepAction')
  })
  it('does not export completeOnboardingStepAction', async () => {
    const mod = await import('./brand-onboarding')
    expect(mod).not.toHaveProperty('completeOnboardingStepAction')
  })
})
