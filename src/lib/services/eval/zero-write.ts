import {
  setAuditWriteSeam,
  resetAuditEmitterForTests,
  type AuditRecord,
} from '@/lib/audit/emit'

// ---------------------------------------------------------------------------
// AuditCollector
// ---------------------------------------------------------------------------

export type AuditCollector = {
  /** Append a record (called by the injected audit seam). */
  push(record: AuditRecord): void
  /** Return only the records belonging to `correlationId`. */
  byCorrelation(correlationId: string): AuditRecord[]
  /** All captured records. */
  all(): AuditRecord[]
}

function createCollector(): AuditCollector {
  const records: AuditRecord[] = []
  return {
    push(record) {
      records.push(record)
    },
    byCorrelation(correlationId) {
      return records.filter((r) => r.correlationId === correlationId)
    },
    all() {
      return [...records]
    },
  }
}

// ---------------------------------------------------------------------------
// installSeams
// ---------------------------------------------------------------------------

/**
 * Installs zero-write seams for eval runs:
 * - Intercepts audit writes via `setAuditWriteSeam`, capturing records into a
 *   collector keyed by `correlationId`.
 * - Sets `CURATION_EVAL_SINK` so `insertAiCallResult` diverts to a local file
 *   instead of Postgres.
 *
 * Returns `{ collector, restore }`. Call `restore()` when the run finishes.
 */
export function installSeams({ sinkPath }: { sinkPath: string }): {
  collector: AuditCollector
  restore: () => void
} {
  const collector = createCollector()

  setAuditWriteSeam(async (record) => {
    collector.push(record)
    return null
  })

  process.env.CURATION_EVAL_SINK = sinkPath

  return {
    collector,
    restore() {
      resetAuditEmitterForTests()
      delete process.env.CURATION_EVAL_SINK
    },
  }
}

// ---------------------------------------------------------------------------
// assertNoNewAuditRows
// ---------------------------------------------------------------------------

type RowCounter = (table: string, since: Date) => Promise<number>

async function defaultCount(table: string, since: Date): Promise<number> {
  const { createServiceClient } = await import('@/lib/supabase/service')
  const { count, error } = await createServiceClient()
    .from(table)
    .select('*', { count: 'exact', head: true })
    .gt('created_at', since.toISOString())

  if (error) throw new Error(`Failed to count ${table}: ${error.message}`)
  return count ?? 0
}

const GUARDED_TABLES = ['external_call_audit', 'brand_ai_results'] as const

/**
 * Asserts that no new rows appeared in the audit tables after `since`.
 * The `count` parameter injects the query function so tests avoid hitting
 * Supabase. Defaults to a real `createServiceClient()` query.
 */
export async function assertNoNewAuditRows({
  since,
  count = defaultCount,
}: {
  since: Date
  count?: RowCounter
}): Promise<void> {
  const violations: string[] = []

  for (const table of GUARDED_TABLES) {
    const n = await count(table, since)
    if (n > 0) {
      violations.push(`${table} has ${n} new row(s) since ${since.toISOString()}`)
    }
  }

  if (violations.length > 0) {
    throw new Error(`Zero-write assertion failed: ${violations.join('; ')}`)
  }
}
