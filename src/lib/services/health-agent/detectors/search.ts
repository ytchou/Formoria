/**
 * Search quality detector — queries PostHog for degraded search share
 * and intent-parse failure rate.
 *
 * Uses the injected PostHogQueryClient (DI via ctx.deps.posthogClient)
 * so the test can supply a fake without mocking Supabase or PostHog.
 */

import type { PostHogQueryClient } from '@/lib/adapters/posthog/query-api'
import { stableFingerprint, type HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Degraded share above this triggers a finding. */
const DEGRADED_SHARE_THRESHOLD = 0.2

/** Intent-parse failure share above this triggers a finding. */
const INTENT_PARSE_FAILURE_THRESHOLD = 0.1

// ---------------------------------------------------------------------------
// HogQL query
// ---------------------------------------------------------------------------

/**
 * A single aggregate query that counts:
 * - total search events in the past 24 hours
 * - degraded searches (those with degraded=true property)
 * - intent-parse failures (those with intent_parse_failed=true property)
 */
const SEARCH_QUALITY_QUERY = `
  SELECT
    count() AS total_searches,
    countIf(properties.degraded = 'true') AS degraded_count,
    countIf(properties.intent_parse_failed = 'true') AS intent_parse_failures
  FROM events
  WHERE event = 'situation_search_executed'
    AND timestamp >= now() - INTERVAL 1 DAY
`

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const searchDetector: Detector = {
  name: 'search-quality',
  source: 'search',
  schedule: 'nightly',
  severity: 'medium',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const client = ctx.deps.posthogClient as PostHogQueryClient | undefined
    if (!client) return []

    const findings: HealthFinding[] = []

    const result = await client.run(
      'health-search-quality',
      SEARCH_QUALITY_QUERY,
    )

    const colIdx = (name: string) =>
      result.columns.indexOf(name)

    const row = result.results[0]
    if (!row) return findings

    const totalSearches = Number(row[colIdx('total_searches')] ?? 0)
    const degradedCount = Number(row[colIdx('degraded_count')] ?? 0)
    const intentFailures = Number(
      row[colIdx('intent_parse_failures')] ?? 0,
    )

    // No search events — nothing to report
    if (totalSearches === 0) return findings

    const degradedShare = degradedCount / totalSearches
    const intentFailureShare = intentFailures / totalSearches

    if (degradedShare > DEGRADED_SHARE_THRESHOLD) {
      findings.push({
        source: 'search',
        fingerprint: stableFingerprint(
          'search',
          'degraded-share',
          ctx.date,
        ),
        title: `Search degraded share ${(degradedShare * 100).toFixed(1)}% exceeds ${(DEGRADED_SHARE_THRESHOLD * 100).toFixed(0)}% threshold`,
        severity: 'medium',
        evidence: {
          totalSearches,
          degradedCount,
          degradedShare: Math.round(degradedShare * 1000) / 1000,
          threshold: DEGRADED_SHARE_THRESHOLD,
        },
        mergePolicy: 'human',
      })
    }

    if (intentFailureShare > INTENT_PARSE_FAILURE_THRESHOLD) {
      findings.push({
        source: 'search',
        fingerprint: stableFingerprint(
          'search',
          'intent-parse-failures',
          ctx.date,
        ),
        title: `Intent-parse failure share ${(intentFailureShare * 100).toFixed(1)}% exceeds ${(INTENT_PARSE_FAILURE_THRESHOLD * 100).toFixed(0)}% threshold`,
        severity: 'medium',
        evidence: {
          totalSearches,
          intentFailures,
          intentFailureShare:
            Math.round(intentFailureShare * 1000) / 1000,
          threshold: INTENT_PARSE_FAILURE_THRESHOLD,
        },
        mergePolicy: 'human',
      })
    }

    return findings
  },
}
