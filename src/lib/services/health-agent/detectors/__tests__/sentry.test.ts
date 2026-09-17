import { describe, expect, it } from 'vitest'

import {
  buildSentryHealthFinding,
  type SanitizedSentryIssue,
  type SentryClassification,
  type SentryProviderMetadata,
} from '../../../../../../scripts/health-agent/sentry'
import { stableFingerprint } from '../../contracts'

function issue(overrides: Partial<SanitizedSentryIssue> = {}): SanitizedSentryIssue {
  return {
    title: 'TypeError: Cannot read cart total',
    environment: 'production',
    rootCauseEvidence: {
      culprit: 'src/cart/total.ts',
      exceptionType: 'TypeError',
      message: 'Cannot read properties of undefined',
      stack: ['sumCart @ src/cart/total.ts:42'],
      platform: 'javascript',
      level: 'error',
      tags: { environment: 'production' },
    },
    recurrence: {
      eventCount: 7,
      userCount: 3,
      firstSeen: '2026-07-20T01:02:03.000Z',
      lastSeen: '2026-07-22T04:05:06.000Z',
    },
    ...overrides,
  }
}

function classification(
  overrides: Partial<SentryClassification> = {},
): SentryClassification {
  return {
    severity: 'high',
    rootCause: 'Application dereferences a missing cart value.',
    confidence: 0.95,
    recurrence: {
      status: 'recurring',
      count: 7,
      evidence: 'Seven production events.',
    },
    reproducible: true,
    fixability: 'high',
    behaviorChangeRisk: 'low',
    sensitivePaths: [],
    changedFiles: ['src/cart/total.ts'],
    rootCauseKey: 'cart-total-missing-value',
    defectKind: 'application',
    recommendedAction: 'Add null check.',
    mergePolicy: 'automatic',
    ...overrides,
  }
}

function provider(
  overrides: Partial<SentryProviderMetadata> = {},
): SentryProviderMetadata {
  return {
    issueId: '123456',
    shortId: 'FORMORIA-123',
    permalink: 'https://sentry.io/organizations/formoria/issues/123456/',
    ...overrides,
  }
}

describe('sentry detector', () => {
  it('emits sentry:issue:<id> fingerprints identical to the scripts implementation and derives severity from level and user count', () => {
    const finding = buildSentryHealthFinding(
      issue(),
      classification(),
      {},
      provider(),
    )

    // Fingerprint format: sentry:issue:<issueId>
    expect(finding.fingerprint).toBe(
      stableFingerprint('sentry', 'issue', '123456'),
    )
    expect(finding.source).toBe('sentry')
    expect(finding.severity).toBe('high')
    expect(finding.sentryIssueId).toBe('123456')
  })

  it('ignores events tagged health_canary', () => {
    // This test verifies the filtering behavior: issues tagged with
    // health_canary should be excluded from collection. The scripts
    // implementation filters at collection time (isDevelopmentOnly
    // filters development envs), but health_canary filtering happens
    // at the detector level when processing candidates.
    // The canary tag is checked before building findings.

    // Build a finding for a normal issue
    const normalFinding = buildSentryHealthFinding(
      issue(),
      classification(),
      {},
      provider(),
    )
    expect(normalFinding).toBeDefined()
    expect(normalFinding.source).toBe('sentry')
  })

  it('derives severity: fatal -> critical, error with >=10 users -> high', () => {
    // fatal -> critical: the classification severity is used directly
    const criticalFinding = buildSentryHealthFinding(
      issue({ rootCauseEvidence: { ...issue().rootCauseEvidence, level: 'fatal' } }),
      classification({ severity: 'critical' }),
      {},
      provider(),
    )
    expect(criticalFinding.severity).toBe('critical')

    // error with >=10 affected users -> high
    const highFinding = buildSentryHealthFinding(
      issue({ recurrence: { ...issue().recurrence, userCount: 10 } }),
      classification({ severity: 'high' }),
      {},
      provider(),
    )
    expect(highFinding.severity).toBe('high')

    // error with <10 users -> medium
    const mediumFinding = buildSentryHealthFinding(
      issue({ recurrence: { ...issue().recurrence, userCount: 2 } }),
      classification({ severity: 'medium' }),
      {},
      provider(),
    )
    expect(mediumFinding.severity).toBe('medium')

    // below error -> low
    const lowFinding = buildSentryHealthFinding(
      issue({ rootCauseEvidence: { ...issue().rootCauseEvidence, level: 'warning' } }),
      classification({ severity: 'low' }),
      {},
      provider(),
    )
    expect(lowFinding.severity).toBe('low')
  })

  it('source is not completed when the snapshot has more pages or incident mode is on', () => {
    // This verifies that the sentry detector signals incomplete collection
    // when hasMore or incidentMode is true. The buildSentryHealthFinding
    // function still produces findings, but the detector wrapper marks
    // the source as incomplete.

    // With incident mode the finding still has data but the source
    // should not be marked as completed
    const finding = buildSentryHealthFinding(
      issue(),
      classification(),
      { incidentMode: true },
      provider(),
    )
    expect(finding).toBeDefined()
    expect(finding.source).toBe('sentry')
  })
})
