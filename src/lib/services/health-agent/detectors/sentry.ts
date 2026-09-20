/**
 * Sentry detector — maps a complete unresolved production snapshot into
 * signal-only health findings. Diagnosis and repair belong to the ops-agent.
 */

import type {
  ListIssuesOptions,
  SentryIssue,
} from '@/lib/adapters/sentry/issues'
import { mapWithConcurrency } from '@/lib/services/_shared/concurrency'
import {
  stableFingerprint,
  type HealthFinding,
  type HealthSeverity,
} from '../contracts'
import type { Detector } from '../types'
import type { SentryClassification } from '../classifiers/sentry-classify'
import { decideSentryMergePolicy } from '../classifiers/sentry-merge-policy'

const SENTRY_LOOKBACK_HOURS = 48
const MAX_SENTRY_ISSUES = 100
const CLASSIFY_CONCURRENCY = 4

export type SentryDetectorDeps = {
  listIssues: (
    hours?: number,
    options?: ListIssuesOptions,
  ) => Promise<SentryIssue[]>
  classify?: (issue: SentryIssue) => Promise<SentryClassification | null>
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

function baseEvidence(issue: SentryIssue) {
  return {
    count: eventCount(issue.count),
    userCount: issue.userCount,
    lastSeen: issue.lastSeen,
    level: issue.level,
    permalink: issue.permalink,
  }
}

export function sentryIssueToFinding(issue: SentryIssue): HealthFinding {
  return {
    source: 'sentry',
    fingerprint: stableFingerprint('sentry', 'issue', issue.id),
    title: issue.title,
    severity: severityForIssue(issue),
    evidence: baseEvidence(issue),
    mergePolicy: 'human',
    sentryIssueId: issue.id,
  }
}

/**
 * Build an enriched finding from a classified issue. Uses the classification's
 * severity instead of the basic heuristic, and sets merge policy from the
 * policy decision.
 */
export function classifiedIssueToFinding(
  issue: SentryIssue,
  classification: SentryClassification,
): HealthFinding {
  const policy = decideSentryMergePolicy(classification)
  const safeFiles = classification.changedFiles.filter(
    (p) => !p.includes('..') && !p.startsWith('/'),
  )
  return {
    source: 'sentry',
    fingerprint: stableFingerprint('sentry', 'issue', issue.id),
    title: issue.title,
    severity: classification.severity,
    evidence: {
      ...baseEvidence(issue),
      rootCause: classification.rootCause,
      fixability: classification.fixability,
      confidence: classification.confidence,
    },
    mergePolicy: policy.mergePolicy,
    ...(policy.humanReason ? { humanReason: policy.humanReason } : {}),
    ...(safeFiles.length > 0 ? { changedFiles: safeFiles } : {}),
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

      if (!deps.classify) {
        return issues.map(sentryIssueToFinding)
      }

      const classify = deps.classify
      const classifications = await mapWithConcurrency(
        issues,
        CLASSIFY_CONCURRENCY,
        async (issue) => {
          try {
            return await classify(issue)
          } catch {
            return null
          }
        },
      )

      return issues.map((issue, i) => {
        const classification = classifications[i]
        if (classification) {
          return classifiedIssueToFinding(issue, classification)
        }
        return sentryIssueToFinding(issue)
      })
    },
  }
}
