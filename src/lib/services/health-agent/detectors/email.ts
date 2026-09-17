/**
 * Email detector — monitors external_call_audit_spans for failed Resend sends
 * in the past 24 hours.
 */

import { stableFingerprint, type HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'
import { pagedRead, type PageableQuery } from '../paged-read'

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const LOOKBACK_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

type SpanRow = {
  span_id: string
  provider: string
  terminal_status: string | null
  started_at: string
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const emailDetector: Detector = {
  name: 'email',
  source: 'pipeline',
  schedule: 'nightly',
  severity: 'medium',

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
        select: 'span_id, provider, terminal_status, started_at',
        filters: [{ column: 'provider', value: 'resend' }],
      },
    )

    const recentSpans = allSpans.filter(
      (s) => s.started_at >= lookbackCutoff,
    )

    const failedCount = recentSpans.filter(
      (s) => s.terminal_status === 'failed',
    ).length

    if (failedCount > 0) {
      findings.push({
        source: 'pipeline',
        fingerprint: stableFingerprint(
          'pipeline',
          'resend-failures',
          ctx.date,
        ),
        title: `${failedCount} Resend email sends failed in the past 24 hours`,
        severity: failedCount >= 5 ? 'high' : 'medium',
        evidence: {
          failedCount,
          totalCount: recentSpans.length,
          window: '24h',
        },
        mergePolicy: 'human',
      })
    }

    return findings
  },
}
