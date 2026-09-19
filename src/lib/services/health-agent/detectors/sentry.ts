/**
 * Sentry detector — maps a complete unresolved production snapshot into
 * signal-only health findings. Diagnosis and repair belong to the ops-agent.
 */

import type {
  ListIssuesOptions,
  SentryIssue,
} from '@/lib/adapters/sentry/issues'
import {
  stableFingerprint,
  type HealthFinding,
  type HealthSeverity,
} from '../contracts'
import type { Detector } from '../types'

const SENTRY_LOOKBACK_HOURS = 48
const MAX_SENTRY_ISSUES = 100

export type SentryDetectorDeps = {
  listIssues: (
    hours?: number,
    options?: ListIssuesOptions,
  ) => Promise<SentryIssue[]>
}

function severityForIssue(issue: SentryIssue): HealthSeverity {
  if (issue.level.toLowerCase() === 'fatal') return 'critical'
  if (issue.level.toLowerCase() === 'error') {
    return issue.userCount >= 10 ? 'high' : 'medium'
  }
  return 'low'
}

function eventCount(count: string): number {
  const parsed = Number.parseInt(count, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export function sentryIssueToFinding(issue: SentryIssue): HealthFinding {
  return {
    source: 'sentry',
    fingerprint: stableFingerprint('sentry', 'issue', issue.id),
    title: issue.title,
    severity: severityForIssue(issue),
    evidence: {
      count: eventCount(issue.count),
      userCount: issue.userCount,
      lastSeen: issue.lastSeen,
      level: issue.level,
      permalink: issue.permalink,
    },
    mergePolicy: 'human',
    sentryIssueId: issue.id,
  }
}

export function sentryDetector(deps: SentryDetectorDeps): Detector {
  return {
    name: 'sentry-triage',
    source: 'sentry',
    schedule: 'nightly',
    severity: 'high',
    thresholds: {
      maxIssues: MAX_SENTRY_ISSUES,
      lookbackHours: SENTRY_LOOKBACK_HOURS,
    },

    async run(): Promise<HealthFinding[]> {
      const issues = await deps.listIssues(SENTRY_LOOKBACK_HOURS, {
        limit: MAX_SENTRY_ISSUES,
        excludeHealthCanary: true,
        requireComplete: true,
      })
      return issues.map(sentryIssueToFinding)
    },
  }
}
