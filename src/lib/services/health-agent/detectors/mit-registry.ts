/**
 * MIT registry detector — checks the most recent sync_registry audit span
 * to detect syncs that wrote zero rows.
 */

import { stableFingerprint, type HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'
import { pagedRead, type PageableQuery } from '../paged-read'

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

type SpanRow = {
  span_id: string
  provider: string
  operation: string | null
  terminal_status: string | null
  started_at: string
  summary: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const mitRegistryDetector: Detector = {
  name: 'mit-registry',
  source: 'pipeline',
  schedule: 'nightly',
  severity: 'medium',

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const supabase = ctx.deps.supabase as {
      from: (table: string) => PageableQuery<unknown>
    }
    const findings: HealthFinding[] = []

    const spans = await pagedRead<SpanRow>(
      supabase,
      'external_call_audit_spans',
      {
        orderBy: [{ column: 'started_at', ascending: false }],
        select:
          'span_id, provider, operation, terminal_status, started_at, summary',
        filters: [
          { column: 'provider', value: 'mit-registry' },
          { column: 'operation', value: 'sync_registry' },
        ],
      },
    )

    // Check the most recent sync
    const latestSync = spans[0]
    if (!latestSync) return findings

    if (latestSync.terminal_status === 'succeeded') {
      const summary = latestSync.summary
      const upsertedCount =
        typeof summary?.upsertedCount === 'number'
          ? summary.upsertedCount
          : null

      if (upsertedCount === 0) {
        findings.push({
          source: 'pipeline',
          fingerprint: stableFingerprint(
            'pipeline',
            'zero-row-sync',
            'mit-registry',
          ),
          title:
            'MIT registry sync completed but wrote zero rows',
          severity: 'medium',
          evidence: {
            spanId: latestSync.span_id,
            startedAt: latestSync.started_at,
            upsertedCount: 0,
          },
          mergePolicy: 'human',
        })
      }
    }

    return findings
  },
}
