import { describe, expect, it } from 'vitest'
import type { Brand } from '@/lib/types'
import {
  buildBrandEditDefaultValues,
  getCompletedWizardSteps,
  getInitialWizardStep,
} from './brand-edit-defaults'

describe('buildBrandEditDefaultValues', () => {
  it('removes database nulls that invalidate optional form fields', () => {
    const defaults = buildBrandEditDefaultValues({
      name: 'Brand One',
      description: null,
      city: null,
      foundingYear: null,
      priceRange: null,
      reputationSummary: null,
    } as Brand)

    expect(defaults.name).toBe('Brand One')
    expect(defaults).not.toHaveProperty('description')
    expect(defaults).not.toHaveProperty('city')
    expect(defaults).not.toHaveProperty('foundingYear')
    expect(defaults).not.toHaveProperty('priceRange')
  })

  it('maps stored reputation data into wizard fields', () => {
    const defaults = buildBrandEditDefaultValues({
      reputationSummary: {
        text: 'Well reviewed',
        sources: [{ url: 'https://example.com/review' }],
      },
    } as Brand)

    expect(defaults.reputationSummary).toBe('Well reviewed')
    expect(defaults.reputationSources).toEqual([{ url: 'https://example.com/review' }])
  })

  it('includes stored romanizedName in dashboard form defaults', () => {
    const defaults = buildBrandEditDefaultValues({
      romanizedName: 'Warmwood Living',
    } as Brand)

    expect(defaults.romanizedName).toBe('Warmwood Living')
  })

  it('ignores internal progress metadata when building form defaults', () => {
    const defaults = buildBrandEditDefaultValues(
      { name: 'Brand One' } as Brand,
      {
        name: 'Draft Brand',
        __wizardCompletedSteps: [0, 2],
      },
    )

    expect(defaults.name).toBe('Draft Brand')
    expect(defaults).not.toHaveProperty('__wizardCompletedSteps')
  })
})

describe('getCompletedWizardSteps', () => {
  it('returns normalized saved wizard progress from draft data', () => {
    expect(
      getCompletedWizardSteps({
        __wizardCompletedSteps: [2, 0, 2, -1, 'x'],
      }),
    ).toEqual([0, 2])
  })
})

describe('getInitialWizardStep', () => {
  it('uses the explicit query step when provided', () => {
    expect(getInitialWizardStep('3', [0, 1], 5)).toBe(3)
  })

  it('falls back to the next incomplete step from saved progress', () => {
    expect(getInitialWizardStep(undefined, [0, 1], 5)).toBe(2)
  })

  it('resumes at the first missing step when saved progress is sparse', () => {
    expect(getInitialWizardStep(undefined, [0, 2], 5)).toBe(1)
  })

  it('caps the inferred step at the final wizard step', () => {
    expect(getInitialWizardStep(undefined, [0, 1, 2, 3, 4], 5)).toBe(4)
  })
})
