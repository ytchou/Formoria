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

type RowCounter = (
  table: string,
  since: Date,
  ids: string[],
  idColumn: string,
) => Promise<number>

/** Chunk size for `.in()` filters — keeps query strings sane for 30-item × 3-arm runs. */
const CHUNK_SIZE = 100

async function defaultCount(
  table: string,
  since: Date,
  ids: string[],
  idColumn: string,
): Promise<number> {
  const { createServiceClient } = await import('@/lib/supabase/service')
  const client = createServiceClient()
  let total = 0

  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE)
    const { count, error } = await client
      .from(table)
      .select('*', { count: 'exact', head: true })
      .gt('created_at', since.toISOString())
      .in(idColumn, chunk)

    if (error) throw new Error(`Failed to count ${table}: ${error.message}`)
    total += count ?? 0
  }

  return total
}

/**
 * Asserts that no new rows written by THIS run appeared in the audit tables.
 *
 * Both `correlationIds` and `spanIds` are **required** — an optional scope
 * would silently restore the global count at any call site that forgets it.
 *
 * - `external_call_audit` is scoped by `correlation_id ∈ correlationIds`.
 * - `brand_ai_results` is scoped by `audit_span_id ∈ spanIds`. When `spanIds`
 *   is empty the query is skipped (no intercepted call → no span could have
 *   escaped). This cannot see a row with a NULL `audit_span_id`, which is why
 *   the static insert-site guard test exists.
 *
 * - `brand_search_results` and `curated_product_candidates` are scoped by
 *   `submission_id ∈ submissionIds`, only when `submissionIds` is passed.
 *   Neither table carries a correlation id; a caller that runs phases against
 *   synthetic submission ids (golden capture) opts in with those ids.
 *
 * The `count` parameter injects the query function so tests avoid hitting
 * Supabase. Defaults to a real `createServiceClient()` query.
 */
export async function assertNoNewAuditRows({
  since,
  correlationIds,
  spanIds,
  submissionIds,
  count = defaultCount,
}: {
  since: Date
  correlationIds: string[]
  spanIds: string[]
  submissionIds?: string[]
  count?: RowCounter
}): Promise<void> {
  if (correlationIds.length === 0) {
    throw new Error(
      'assertNoNewAuditRows: correlationIds is empty — cannot verify a run with no correlation ids',
    )
  }
  if (submissionIds !== undefined && submissionIds.length === 0) {
    throw new Error(
      'assertNoNewAuditRows: submissionIds is empty — pass the run\'s submission ids or omit the option',
    )
  }

  const violations: string[] = []

  // external_call_audit: scoped by correlation_id
  const auditCount = await count('external_call_audit', since, correlationIds, 'correlation_id')
  if (auditCount > 0) {
    violations.push(
      `external_call_audit has ${auditCount} new row(s) since ${since.toISOString()}`,
    )
  }

  // brand_ai_results: scoped by audit_span_id — skip when spanIds is empty
  // (no intercepted call means no span could have escaped)
  if (spanIds.length > 0) {
    const aiCount = await count('brand_ai_results', since, spanIds, 'audit_span_id')
    if (aiCount > 0) {
      violations.push(
        `brand_ai_results has ${aiCount} new row(s) since ${since.toISOString()}`,
      )
    }
  }

  if (submissionIds) {
    for (const table of ['brand_search_results', 'curated_product_candidates']) {
      const rows = await count(table, since, submissionIds, 'submission_id')
      if (rows > 0) {
        violations.push(`${table} has ${rows} new row(s) since ${since.toISOString()}`)
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`Zero-write assertion failed: ${violations.join('; ')}`)
  }
}
