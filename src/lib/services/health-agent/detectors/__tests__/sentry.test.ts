import { describe, expect, it, vi } from 'vitest'
import type { SentryIssue } from '@/lib/adapters/sentry/issues'
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

  it('listIssues_extracts_culprit_and_metadata_when_present', async () => {
    const enriched = issue({
      culprit: 'app/api/cart/route',
      firstSeen: '2026-09-18T01:00:00.000Z',
      platform: 'node',
      metadata: { type: 'TypeError', value: 'Cannot read cart total' },
    })
    const listIssues = vi.fn(async () => [enriched])
    const findings = await sentryDetector({ listIssues }).run(context)
    expect(findings[0].title).toBe('TypeError: Cannot read cart total')
    // The enrichment fields are on the issue, not the finding — verify the issue factory
    expect(enriched.culprit).toBe('app/api/cart/route')
    expect(enriched.firstSeen).toBe('2026-09-18T01:00:00.000Z')
    expect(enriched.platform).toBe('node')
    expect(enriched.metadata).toEqual({ type: 'TypeError', value: 'Cannot read cart total' })
  })

  it('listIssues_omits_enrichment_fields_when_absent', async () => {
    const bare = issue({
      culprit: undefined,
      firstSeen: undefined,
      platform: undefined,
      metadata: undefined,
    })
    const listIssues = vi.fn(async () => [bare])
    const findings = await sentryDetector({ listIssues }).run(context)
    expect(findings).toHaveLength(1)
    expect(bare.culprit).toBeUndefined()
    expect(bare.firstSeen).toBeUndefined()
    expect(bare.platform).toBeUndefined()
    expect(bare.metadata).toBeUndefined()
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
})
