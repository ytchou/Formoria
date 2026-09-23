import { describe, expect, it, vi } from 'vitest'
import type { SentryIssue } from '@/lib/adapters/sentry/issues'
import type { SentryClassification } from '../../classifiers/sentry-classify'
import type { DetectorContext } from '../../types'
import { sentryDetector, sentryIssueToFinding } from '../sentry'

function issue(overrides: Partial<SentryIssue> = {}): SentryIssue {
  return {
    id: '123456',
    title: 'TypeError: Cannot read cart total',
    count: '7',
    userCount: 3,
    lastSeen: '2026-09-19T04:05:06.000Z',
    permalink: 'https://sentry.io/organizations/formoria/issues/123456/',
    level: 'error',
    culprit: 'app/api/cart/route',
    firstSeen: '2026-09-18T01:00:00.000Z',
    platform: 'node',
    metadata: { type: 'TypeError', value: 'Cannot read cart total' },
    ...overrides,
  }
}

const context: DetectorContext = {
  date: '2026-09-19',
  deadline: Date.now() + 30_000,
  signal: new AbortController().signal,
  dryRun: false,
  deps: {},
}

describe('sentry detector', () => {
  it('requests the bounded complete health snapshot and maps stable human findings', async () => {
    const listIssues = vi.fn(async () => [issue()])

    const findings = await sentryDetector({ listIssues }).run(context)

    expect(listIssues).toHaveBeenCalledWith(48, {
      limit: 100,
      excludeHealthCanary: true,
      requireComplete: true,
    })
    expect(findings).toEqual([
      {
        source: 'sentry',
        fingerprint: 'sentry:issue:123456',
        title: 'TypeError: Cannot read cart total',
        severity: 'medium',
        mergePolicy: 'human',
        sentryIssueId: '123456',
        evidence: {
          count: 7,
          userCount: 3,
          lastSeen: '2026-09-19T04:05:06.000Z',
          level: 'error',
          permalink: 'https://sentry.io/organizations/formoria/issues/123456/',
        },
      },
    ])
  })

  it('derives severity from provider level and affected users', () => {
    expect(sentryIssueToFinding(issue({ level: 'fatal' })).severity).toBe('critical')
    expect(sentryIssueToFinding(issue({ userCount: 10 })).severity).toBe('high')
    expect(sentryIssueToFinding(issue({ userCount: 2 })).severity).toBe('medium')
    expect(sentryIssueToFinding(issue({ level: 'warning' })).severity).toBe('low')
  })

  it('uses the issue id for a stable fingerprint regardless of mutable fields', () => {
    const first = sentryIssueToFinding(issue())
    const later = sentryIssueToFinding(issue({
      title: 'A changed title',
      count: '99',
      userCount: 12,
      level: 'fatal',
    }))

    expect(first.fingerprint).toBe('sentry:issue:123456')
    expect(later.fingerprint).toBe(first.fingerprint)
  })

  // -------------------------------------------------------------------
  // Classification integration
  // -------------------------------------------------------------------

  it('sentryDetector_classifies_issues_when_classify_dep_provided', async () => {
    const classification: SentryClassification = {
      severity: 'medium',
      rootCause: 'Null reference in cart handler',
      confidence: 0.95,
      fixability: 'high',
      mergePolicy: 'automatic',
      changedFiles: ['src/app/api/cart/route.ts'],
    }
    const classify = vi.fn(async () => classification)
    const listIssues = vi.fn(async () => [issue()])

    const findings = await sentryDetector({ listIssues, classify }).run(context)

    expect(classify).toHaveBeenCalledTimes(1)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('medium')
    expect(findings[0].evidence.rootCause).toBe('Null reference in cart handler')
    expect(findings[0].mergePolicy).toBe('automatic')
    expect(findings[0].changedFiles).toEqual(['src/app/api/cart/route.ts'])
  })

  it('sentryDetector_falls_back_to_basic_severity_when_classify_absent', async () => {
    const listIssues = vi.fn(async () => [issue()])

    const findings = await sentryDetector({ listIssues }).run(context)

    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('medium')
    expect(findings[0].mergePolicy).toBe('human')
    expect(findings[0].evidence.rootCause).toBeUndefined()
  })

  it('sentryDetector_falls_back_when_classify_returns_null', async () => {
    const classify = vi.fn(async () => null)
    const listIssues = vi.fn(async () => [issue()])

    const findings = await sentryDetector({ listIssues, classify }).run(context)

    expect(findings).toHaveLength(1)
    // Falls back to basic heuristic
    expect(findings[0].severity).toBe('medium')
    expect(findings[0].mergePolicy).toBe('human')
    expect(findings[0].evidence.rootCause).toBeUndefined()
  })

  it('sentryDetector_limits_classification_concurrency', async () => {
    let concurrent = 0
    let maxConcurrent = 0

    const classify = vi.fn(async () => {
      concurrent++
      if (concurrent > maxConcurrent) maxConcurrent = concurrent
      // Simulate async work
      await new Promise((resolve) => setTimeout(resolve, 10))
      concurrent--
      return {
        severity: 'medium' as const,
        rootCause: 'Test',
        confidence: 0.9,
        fixability: 'high' as const,
        mergePolicy: 'automatic' as const,
        changedFiles: ['test.ts'],
      }
    })

    // Create 8 issues to test concurrency limiting
    const issues = Array.from({ length: 8 }, (_, i) =>
      issue({ id: String(i) }),
    )
    const listIssues = vi.fn(async () => issues)

    await sentryDetector({ listIssues, classify }).run(context)

    expect(classify).toHaveBeenCalledTimes(8)
    expect(maxConcurrent).toBeLessThanOrEqual(4)
  })
})
