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
})
