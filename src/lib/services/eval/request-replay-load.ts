/**
 * Loader for `llm-eval replay` (DEV-1917, design D6 + data flow step 1).
 *
 * Reads logged production requests from `brand_ai_results` (read-only), page by
 * page, classifies each row into a catalog step and groups rows into spans.
 * One span (`audit_span_id`) is one replay unit, answered by its last `ok:true`
 * row. The Supabase read is an injected dependency so tests never touch a DB.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyReplayRow, type ReplayStep } from './request-replay-steps'

/**
 * Rows per page. `request` and `input` are stored uncut (5–27 KB a row since
 * DEV-1902), so the PostgREST default of 1,000 is too heavy.
 */
export const REPLAY_PAGE_SIZE = 200

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One `brand_ai_results` row, camelCased at the service boundary. */
export type ReplayRow = {
  id: string
  phase: string
  model: string
  createdAt: string
  brandId: string | null
  submissionId: string | null
  /** `brand_submissions.brand_id` of `submissionId`, for the brand count. */
  submissionBrandId: string | null
  jobId: string | null
  auditSpanId: string | null
  /** The stored `LoggedRequest` (`llm-audit.ts`); never null (filtered). */
  request: unknown
  /** `{provider, ok, status, response, usage?, error?}` as `persistAuditEvent` writes it. */
  rawResponse: unknown
  /** `input.meta` only; the rest of `input` is unused by replay. */
  meta: unknown
}

export type ReplaySpan = {
  /** `audit_span_id`, or `row:<id>` for a legacy row without one. */
  spanId: string
  step: ReplayStep
  /** The last `ok:true` row by `created_at`; null when production never succeeded (reported, never replayed). */
  answer: ReplayRow | null
  /** The span's newest row by `created_at`. */
  latest: ReplayRow
  /** `created_at` of the span's newest row; drives newest-first ordering. */
  lastAt: string
}

type ReplayRowRange = { from: number; to: number }
type ReplayRowFilter = { phases: string[]; since?: string }
export type ReplayRowReader = (range: ReplayRowRange, filter: ReplayRowFilter) => Promise<ReplayRow[]>

export type LoadReplaySpansOptions = {
  steps: readonly ReplayStep[]
  since?: string
  /** Max spans per step, newest first. Prod-failed spans count toward it. */
  limit?: number
}

export type LoadReplaySpansDeps = { readRows: ReplayRowReader }

export type LoadReplaySpansResult = {
  spans: ReplaySpan[]
  /** Rows whose phase/shape matched no catalog step. Never returned as spans. */
  unclassified: number
  rowsRead: number
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

function isOk(rawResponse: unknown): boolean {
  return (
    rawResponse !== null &&
    typeof rawResponse === 'object' &&
    (rawResponse as { ok?: unknown }).ok === true
  )
}

function byCreatedAtThenId(a: ReplayRow, b: ReplayRow): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Classifies rows into steps and groups them by span. A validation retry sends
 * a different `user` text under a new span id, so it stays its own span.
 */
export function groupSpans(rows: readonly ReplayRow[]): { spans: ReplaySpan[]; unclassified: number } {
  let unclassified = 0
  const groups = new Map<string, { step: ReplayStep; spanId: string; rows: ReplayRow[] }>()

  for (const row of rows) {
    const step = classifyReplayRow(row)
    if (!step) {
      unclassified++
      continue
    }
    const spanId = row.auditSpanId ?? `row:${row.id}`
    // Keyed by step too, so a span id can never merge two different prompts.
    const key = `${step.name}\u0000${spanId}`
    const group = groups.get(key)
    if (group) group.rows.push(row)
    else groups.set(key, { step, spanId, rows: [row] })
  }

  const spans = [...groups.values()].map(({ step, spanId, rows: spanRows }): ReplaySpan => {
    const sorted = [...spanRows].sort(byCreatedAtThenId)
    const answer = sorted.filter((r) => isOk(r.rawResponse)).at(-1) ?? null
    const latest = sorted.at(-1)!
    return { spanId, step, answer, latest, lastAt: latest.createdAt }
  })
  return { spans, unclassified }
}

function newestFirst(a: ReplaySpan, b: ReplaySpan): number {
  if (a.lastAt !== b.lastAt) return a.lastAt > b.lastAt ? -1 : 1
  return a.spanId < b.spanId ? -1 : a.spanId > b.spanId ? 1 : 0
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * Reads rows for the steps' phases newest first (paged until an empty page, as
 * the harvest loader does, or until every step's `limit` is covered), groups
 * them into spans and keeps the newest `limit` spans per requested step. Rows
 * of a catalog step that was not requested (a shared phase) are dropped
 * silently; rows matching no step are counted.
 */
export async function loadReplaySpans(
  options: LoadReplaySpansOptions,
  deps: LoadReplaySpansDeps,
): Promise<LoadReplaySpansResult> {
  const phases = [...new Set(options.steps.flatMap((step) => step.phases))]
  const filter: ReplayRowFilter = { phases, ...(options.since ? { since: options.since } : {}) }

  // Paged until an empty page: PostgREST caps a page, so a short page is not
  // proof of the end. Offset paging on `created_at desc` shifts when production
  // inserts mid-read, so a row can come back twice: rows are deduped by id.
  //
  // Early stop (with `limit`): rows arrive newest first, so once a step has
  // seen `limit + 1` distinct span ids, its newest `limit` spans by `lastAt` are
  // all known and every one of their rows newer than the read point is in.
  // Ceiling: a kept span's rows older than the read point (a retry minutes
  // before its last row) can be missed, which can mark a span prod-failed whose
  // ok row is older. Spans are seconds long, so the `+1` buffer covers it in
  // practice; upgrade path is a second read by `audit_span_id` for kept spans.
  const wanted = new Set(options.steps.map((step) => step.name))
  const spansSeen = new Map<string, Set<string>>([...wanted].map((name) => [name, new Set<string>()]))
  const covered = () =>
    options.limit !== undefined && [...spansSeen.values()].every((ids) => ids.size > options.limit!)
  const seen = new Set<string>()
  const rows: ReplayRow[] = []
  for (let from = 0; ; ) {
    const page = await deps.readRows({ from, to: from + REPLAY_PAGE_SIZE - 1 }, filter)
    if (page.length === 0) break
    for (const row of page) {
      if (seen.has(row.id)) continue
      seen.add(row.id)
      rows.push(row)
      const step = classifyReplayRow(row)
      if (step) spansSeen.get(step.name)?.add(row.auditSpanId ?? `row:${row.id}`)
    }
    from += page.length
    if (covered()) break
  }

  const { spans, unclassified } = groupSpans(rows)
  const perStep = new Map<string, number>()
  const kept = spans
    .filter((span) => wanted.has(span.step.name))
    .sort(newestFirst)
    .filter((span) => {
      if (options.limit === undefined) return true
      const n = perStep.get(span.step.name) ?? 0
      if (n >= options.limit) return false
      perStep.set(span.step.name, n + 1)
      return true
    })

  return { spans: kept, unclassified, rowsRead: rows.length }
}

// ---------------------------------------------------------------------------
// Span identity
// ---------------------------------------------------------------------------

/** The row a span is described by: its answer, else its newest row. */
export function leadRow(span: ReplaySpan): ReplayRow {
  return span.answer ?? span.latest
}

/**
 * The span's brand, for the distinct-brand count: `brand_id`, else the brand
 * of the submission, else the submission itself, else the span alone.
 */
export function brandKeyOf(span: ReplaySpan): string {
  const lead = leadRow(span)
  const brandId = lead.brandId ?? lead.submissionBrandId
  if (brandId) return `brand:${brandId}`
  if (lead.submissionId) return `submission:${lead.submissionId}`
  return `span:${span.spanId}`
}

// ---------------------------------------------------------------------------
// Production reader
// ---------------------------------------------------------------------------

const REPLAY_COLUMNS =
  'id, phase, model, created_at, brand_id, submission_id, job_id, audit_span_id, request, raw_response, input, brand_submissions(brand_id)'

/** The selected `brand_ai_results` columns, as PostgREST returns them. */
export type ReplayDbRow = {
  id: string
  phase: string
  model: string
  created_at: string
  brand_id: string | null
  submission_id: string | null
  job_id: string | null
  audit_span_id: string | null
  request: unknown
  raw_response: unknown
  input: unknown
  brand_submissions: { brand_id: string | null } | Array<{ brand_id: string | null }> | null
}

/**
 * A PostgREST embed as one row. supabase-js types an embedded relation as an
 * array even when the foreign key makes it many-to-one (an object at runtime),
 * so both shapes are accepted.
 */
export function embedOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export function toReplayRow(row: ReplayDbRow): ReplayRow {
  const input = row.input
  const meta =
    input !== null && typeof input === 'object' && !Array.isArray(input)
      ? ((input as { meta?: unknown }).meta ?? null)
      : null
  return {
    id: row.id,
    phase: row.phase,
    model: row.model,
    createdAt: row.created_at,
    brandId: row.brand_id,
    submissionId: row.submission_id,
    submissionBrandId: embedOne(row.brand_submissions)?.brand_id ?? null,
    jobId: row.job_id,
    auditSpanId: row.audit_span_id,
    request: row.request,
    rawResponse: row.raw_response,
    meta,
  }
}

/**
 * The production `ReplayRowReader`. Read-only. The caller passes the client so
 * the orchestrator can choose it by `--target`.
 */
export function supabaseReplayRowReader(client: SupabaseClient): ReplayRowReader {
  return async (range, filter) => {
    let query = client
      .from('brand_ai_results')
      .select(REPLAY_COLUMNS)
      .in('phase', filter.phases)
      .not('request', 'is', null)
    if (filter.since) query = query.gte('created_at', new Date(filter.since).toISOString())
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(range.from, range.to)
    if (error) throw new Error(`[replay] brand_ai_results read failed: ${error.message}`)
    return ((data ?? []) as unknown as ReplayDbRow[]).map(toReplayRow)
  }
}
