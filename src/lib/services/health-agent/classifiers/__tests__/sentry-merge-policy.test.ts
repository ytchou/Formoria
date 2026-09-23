import { describe, expect, it } from 'vitest'
import type { SentryClassification } from '../sentry-classify'
import { decideSentryMergePolicy } from '../sentry-merge-policy'

function classification(
  overrides: Partial<SentryClassification> = {},
): SentryClassification {
  return {
    severity: 'medium',
    rootCause: 'Null reference in cart handler',
    confidence: 0.9,
    fixability: 'high',
    mergePolicy: 'automatic',
    changedFiles: ['src/app/api/cart/route.ts'],
    ...overrides,
  }
}

describe('sentry merge policy', () => {

  it('decideSentryMergePolicy_returns_automatic_when_all_conditions_met', () => {
    const result = decideSentryMergePolicy(classification())

    expect(result.mergePolicy).toBe('automatic')
    expect(result.humanReason).toBeUndefined()
  })

  it('decideSentryMergePolicy_vetoes_to_human_on_critical_severity', () => {
    const result = decideSentryMergePolicy(
      classification({ severity: 'critical' }),
    )

    expect(result.mergePolicy).toBe('human')
    expect(result.humanReason).toContain('critical')
  })

  it('decideSentryMergePolicy_vetoes_to_human_on_high_severity', () => {
    const result = decideSentryMergePolicy(
      classification({ severity: 'high' }),
    )

    expect(result.mergePolicy).toBe('human')
    expect(result.humanReason).toContain('high severity requires human review')
  })

  it('decideSentryMergePolicy_vetoes_to_human_on_low_confidence', () => {
    const result = decideSentryMergePolicy(
      classification({ confidence: 0.5 }),
    )

    expect(result.mergePolicy).toBe('human')
    expect(result.humanReason).toContain('confidence')
  })

  it('decideSentryMergePolicy_vetoes_to_human_on_empty_changed_files', () => {
    const result = decideSentryMergePolicy(
      classification({ changedFiles: [] }),
    )

    expect(result.mergePolicy).toBe('human')
    expect(result.humanReason).toContain('changedFiles')
  })

  it('decideSentryMergePolicy_vetoes_to_human_on_low_fixability', () => {
    const result = decideSentryMergePolicy(
      classification({ fixability: 'low' }),
    )

    expect(result.mergePolicy).toBe('human')
    expect(result.humanReason).toContain('fixability')
  })

  it('decideSentryMergePolicy_vetoes_to_human_when_classifier_says_human', () => {
    const result = decideSentryMergePolicy(
      classification({ mergePolicy: 'human' }),
    )

    expect(result.mergePolicy).toBe('human')
    expect(result.humanReason).toContain('classifier')
  })

  it('decideSentryMergePolicy_accumulates_all_veto_reasons', () => {
    const result = decideSentryMergePolicy(
      classification({
        mergePolicy: 'human',
        severity: 'critical',
        confidence: 0.3,
        changedFiles: [],
        fixability: 'unknown',
      }),
    )

    expect(result.mergePolicy).toBe('human')
    // All five reasons should appear
    expect(result.humanReason).toContain('classifier')
    expect(result.humanReason).toContain('critical')
    expect(result.humanReason).toContain('changedFiles')
    expect(result.humanReason).toContain('confidence')
    expect(result.humanReason).toContain('fixability')
  })
})
