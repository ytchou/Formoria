/**
 * External calls detector — monitors external_call_audit_spans for
 * elevated failure rates per provider and orphan started spans.
 */

import { stableFingerprint, type HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'
import { pagedRead, type PageableQuery } from '../paged-read'

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** A provider with more than this share of non-succeeded terminal spans triggers a finding. */
const FAILURE_RATE_THRESHOLD = 0.3

/** A started span with no terminal row after this window is flagged. */
const ORPHAN_STARTED_THRESHOLD_MS = 60 * 60 * 1000 // 1 hour

/** Look back this far for spans. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

type SpanRow = {
  span_id: string
  provider: string
  operation: string | null
  terminal_status: string | null
  started_at: string
  finished_at: string | null
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const externalCallsDetector: Detector = {
  name: 'external-calls',
  source: 'pipeline',
  schedule: 'nightly',
  severity: 'high',
  thresholds: {
    failureRateThreshold: FAILURE_RATE_THRESHOLD,
    orphanStartedThresholdMs: ORPHAN_STARTED_THRESHOLD_MS,
  },

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const supabase = ctx.deps.supabase as {
      from: (table: string) => PageableQuery<unknown>
    }
    const findings: HealthFinding[] = []
    const now = Date.now()
    const lookbackCutoff = new Date(now - LOOKBACK_MS).toISOString()

    const allSpans = await pagedRead<SpanRow>(
      supabase,
      'external_call_audit_spans',
      {
        orderBy: [{ column: 'span_id' }],
        select:
          'span_id, provider, operation, terminal_status, started_at, finished_at',
      },
    )

    // Filter to recent spans
    const recentSpans = allSpans.filter(
      (s) => s.started_at >= lookbackCutoff,
    )

    // 1. Per-provider failure rate — ignore started (non-terminal) rows
    const terminalSpans = recentSpans.filter(
      (s) => s.terminal_status !== null,
    )
    const providerStats = new Map<
      string,
      { total: number; failed: number }
    >()
    for (const span of terminalSpans) {
      const stats = providerStats.get(span.provider) ?? {
        total: 0,
        failed: 0,
      }
      stats.total += 1
      if (span.terminal_status !== 'succeeded') {
        stats.failed += 1
      }
      providerStats.set(span.provider, stats)
    }

    for (const [provider, stats] of providerStats) {
      if (stats.total === 0) continue
      const failureRate = stats.failed / stats.total
      if (failureRate > FAILURE_RATE_THRESHOLD) {
        findings.push({
          source: 'pipeline',
          fingerprint: stableFingerprint(
            'pipeline',
            'failure-rate',
            provider,
          ),
          title: `Provider "${provider}" failure rate ${(failureRate * 100).toFixed(1)}% exceeds ${(FAILURE_RATE_THRESHOLD * 100).toFixed(0)}% threshold`,
          severity: 'high',
          evidence: {
            provider,
            totalSpans: stats.total,
            failedSpans: stats.failed,
            failureRate: Math.round(failureRate * 1000) / 1000,
          },
          mergePolicy: 'human',
        })
      }
    }

    // 2. Orphan started spans — started but no terminal row after threshold
    const orphanCutoff = new Date(now - ORPHAN_STARTED_THRESHOLD_MS).toISOString()
    const orphanSpans = recentSpans.filter(
      (s) =>
        s.terminal_status === null &&
        s.started_at < orphanCutoff,
    )

    for (const span of orphanSpans) {
      findings.push({
        source: 'pipeline',
        fingerprint: stableFingerprint(
          'pipeline',
          'orphan-started',
          span.span_id,
        ),
        title: `External call span ${span.span_id} (${span.provider}) started but has no terminal status`,
        severity: 'medium',
        evidence: {
          spanId: span.span_id,
          provider: span.provider,
          operation: span.operation,
          startedAt: span.started_at,
        },
        mergePolicy: 'human',
      })
    }

    return findings
  },
}
