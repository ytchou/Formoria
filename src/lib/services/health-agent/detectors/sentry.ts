/**
 * Sentry detector — collects unresolved production issues and produces
 * health findings.
 *
 * Re-uses the collector and finding builder from `scripts/health-agent/sentry.ts`.
 * Filtering: events tagged `health_canary` are excluded at collection time.
 */

import {
  buildSentryHealthFinding,
  collectSentryIssues,
  type SentryClassifier,
  type SentryCollectorOptions,
  type SentryIssueCollection,
} from '../../../../../scripts/health-agent/sentry'
import type { HealthFinding, HealthSeverity } from '../contracts'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum issues to analyze per run. */
export const MAX_SENTRY_ISSUES = 20

/** Lookback period for Sentry issues. */
export const SENTRY_LOOKBACK_DAYS = 14

// ---------------------------------------------------------------------------
// Severity mapping per plan
// ---------------------------------------------------------------------------

/**
 * Map Sentry level + user count to health severity:
 * - fatal -> critical
 * - error with >=10 affected users -> high
 * - other error -> medium
 * - below error -> low
 */
export function mapSentrySeverity(
  level: string | null,
  userCount: number,
): HealthSeverity {
  const normalizedLevel = (level ?? '').toLowerCase()
  if (normalizedLevel === 'fatal') return 'critical'
  if (normalizedLevel === 'error') {
    return userCount >= 10 ? 'high' : 'medium'
  }
  return 'low'
}

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

export type SentryDetectorDeps = {
  collectorOptions: SentryCollectorOptions
  classifier: SentryClassifier
}

/**
 * Whether an issue is a health canary (synthetic probe).
 * Canary events are tagged `health_canary` and must be excluded.
 */
function isHealthCanary(
  issue: { rootCauseEvidence: { tags: Record<string, string> } },
): boolean {
  return issue.rootCauseEvidence.tags.health_canary === 'true'
}

export type SentryDetectorResult = {
  findings: HealthFinding[]
  hasMore: boolean
  incidentMode: boolean
}

export function sentryDetector(deps: SentryDetectorDeps): Detector & {
  /** Exposed for the runner to check source completion. */
  lastCollection?: SentryIssueCollection
} {
  const detector: Detector & { lastCollection?: SentryIssueCollection } = {
    name: 'sentry-triage',
    source: 'sentry',
    schedule: 'nightly',
    severity: 'high',
    thresholds: {
      maxIssues: MAX_SENTRY_ISSUES,
      lookbackDays: SENTRY_LOOKBACK_DAYS,
    },

    async run(_ctx: DetectorContext): Promise<HealthFinding[]> {
      const collection = await collectSentryIssues(deps.collectorOptions)
      detector.lastCollection = collection

      const findings: HealthFinding[] = []

      for (const candidate of collection.candidates) {
        // Filter out health canary events
        if (isHealthCanary(candidate.issue)) continue

        try {
          const classification = await deps.classifier({
            filename: 'sentry-issue.json',
            mediaType: 'application/json',
            value: candidate.issue,
          })

          // Parse classification through the schema
          const { SentryClassificationSchema } = await import(
            '../../../../../scripts/health-agent/sentry'
          )
          const parsed = SentryClassificationSchema.safeParse(classification)
          if (!parsed.success) continue

          const finding = buildSentryHealthFinding(
            candidate.issue,
            parsed.data,
            {
              incidentMode: collection.incidentMode,
            },
            candidate.provider,
          )
          findings.push(finding)
        } catch {
          // Classifier failures are swallowed per spec: agents and detectors
          // never throw to their caller.
        }
      }

      return findings
    },
  }

  return detector
}
