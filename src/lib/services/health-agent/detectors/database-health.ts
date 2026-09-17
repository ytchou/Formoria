/**
 * Database health detector — checks connection saturation, long-running
 * queries, and dead tuple bloat.
 *
 * Re-uses the pure evaluate function from `scripts/health-agent/directory.ts`.
 */

import {
  evaluateDatabaseEvidence,
  type DatabaseEvidence,
} from '../../../../../scripts/health-agent/directory'
import type { HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'

// ---------------------------------------------------------------------------
// Thresholds — named constants matching the evaluate function's built-in
// values, surfaced here for the registry.
// ---------------------------------------------------------------------------

/** Connection usage above this percent triggers a critical finding. */
export const CONNECTION_SATURATION_PERCENT = 80
/** Active queries running longer than this trigger a finding. */
export const SLOW_QUERY_SECONDS = 60
/** Dead tuple percent threshold (across two snapshots). */
export const DEAD_TUPLE_PERCENT = 20

// ---------------------------------------------------------------------------
// DI seam
// ---------------------------------------------------------------------------

type DatabaseHealthRpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>
}

export type DatabaseHealthDeps = {
  supabase: DatabaseHealthRpc
  /** Previous dead-tuple snapshots for recurring detection. */
  previousSnapshots?: DatabaseEvidence['deadTupleSnapshots']
}

export function databaseHealthDetector(deps: DatabaseHealthDeps): Detector {
  return {
    name: 'database-health',
    source: 'directory',
    schedule: 'nightly',
    severity: 'high',
    thresholds: {
      connectionSaturationPercent: CONNECTION_SATURATION_PERCENT,
      slowQuerySeconds: SLOW_QUERY_SECONDS,
      deadTuplePercent: DEAD_TUPLE_PERCENT,
    },

    async run(ctx: DetectorContext): Promise<HealthFinding[]> {
      // Fetch connection health
      const { data: connData, error: connError } = await deps.supabase.rpc(
        'read_pg_stat_activity_summary',
      )
      const connections =
        connError || !connData
          ? { total: 0, maximum: 0 }
          : {
              total: Number(
                (connData as Record<string, unknown>).total_connections ?? 0,
              ),
              maximum: Number(
                (connData as Record<string, unknown>).max_connections ?? 0,
              ),
            }

      // Fetch active queries
      const { data: queryData } = await deps.supabase.rpc(
        'read_pg_stat_activity_queries',
      )
      const activeQueries = Array.isArray(queryData)
        ? queryData.map((row: Record<string, unknown>) => ({
            queryId: String(row.query_id ?? row.pid ?? ''),
            durationSeconds: Number(row.duration_seconds ?? 0),
          }))
        : []

      // Fetch dead tuples
      const { data: tupleData } = await deps.supabase.rpc(
        'read_pg_stat_dead_tuples',
      )
      const currentTables = Array.isArray(tupleData)
        ? tupleData.map((row: Record<string, unknown>) => ({
            tableName: String(row.table_name ?? ''),
            deadTuplePercent: Number(row.dead_tuple_percent ?? 0),
            deadTuples: Number(row.dead_tuples ?? 0),
            liveTuples: Number(row.live_tuples ?? 0),
            autovacuumThreshold: Number(row.autovacuum_threshold ?? 0),
          }))
        : []

      const deadTupleSnapshots = [
        ...(deps.previousSnapshots ?? []),
        { snapshotDate: ctx.date, tables: currentTables },
      ]

      const evidence: DatabaseEvidence = {
        connections,
        activeQueries,
        deadTupleSnapshots,
        indexConcerns: [],
      }

      const result = evaluateDatabaseEvidence(evidence)
      return result.findings
    },
  }
}
