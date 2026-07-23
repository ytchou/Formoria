import type { Phase, PhaseKind, PhaseStatus, RunLog, StepEvent, TokenUsage } from '../runlog'
import { getCurationJob, listCurationJobTargets, type CurationJobTarget } from './curation-jobs'
import { sanitizeJobError } from './job-errors'
import { createServiceClient } from '@/lib/supabase/server'

export const MAX_EVENTS_PER_PHASE = 300
const LEGACY_QUERY_CHUNK_SIZE = 100

const PHASE_ORDER = [
  'discover',
  'image-search',
  'detect',
  'clean',
  'links',
  'images',
  'classify_images',
  'descriptions',
  'locations',
  'expansion',
  'tags',
  'persist',
] as const

const PHASE_KIND: Record<string, PhaseKind> = {
  discover: 'search',
  'image-search': 'search',
  detect: 'llm',
  clean: 'transform',
  links: 'scrape',
  images: 'io',
  classify_images: 'llm',
  descriptions: 'llm',
  locations: 'search',
  expansion: 'llm',
  tags: 'llm',
  persist: 'persist',
}

type UnknownRecord = Record<string, unknown>

type AiAuditRow = {
  id: string
  brand_id: string | null
  submission_id: string | null
  phase: string
  model: string
  latency_ms: number | null
  created_at: string
  attempt: number | null
  usage: unknown
  response_usage: unknown
  audit_ok: unknown
  audit_error?: unknown
}

type SearchAuditRow = {
  id: string
  brand_id: string | null
  submission_id: string | null
  search_type: string
  query: string
  urls: string[] | null
  latency_ms: number | null
  created_at: string
  call_status?: string | null
  http_status?: number | null
  error?: string | null
}

type PhaseResult = {
  phase: string
  status: string
  durationMs: number
  error?: string
  detail?: string
}

type AuditQuery = PromiseLike<{ data: unknown[] | null; error: unknown }> & {
  select: (columns: string) => AuditQuery
  eq: (column: string, value: unknown) => AuditQuery
  in: (column: string, values: string[]) => AuditQuery
  gte: (column: string, value: string) => AuditQuery
  lte: (column: string, value: string) => AuditQuery
  order: (column: string, options: { ascending: boolean }) => AuditQuery
}

type AuditClient = {
  from: (table: string) => AuditQuery
}

type JobAuditQueryResult = {
  rows: unknown[]
  jobIdColumnMissing: boolean
}

function record(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : null
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isMissingJobIdColumn(error: unknown): boolean {
  const source = record(error)
  return source?.code === '42703' && typeof source.message === 'string' && source.message.includes('job_id')
}

function tokenUsage(value: unknown): TokenUsage | undefined {
  const source = record(value)
  if (!source) return undefined
  const input = finiteNumber(source.prompt_tokens ?? source.input)
  const output = finiteNumber(source.completion_tokens ?? source.output)
  const suppliedTotal = finiteNumber(source.total_tokens ?? source.total)
  const total =
    suppliedTotal ?? (input !== undefined || output !== undefined ? (input ?? 0) + (output ?? 0) : undefined)
  return input === undefined && output === undefined && total === undefined
    ? undefined
    : {
        ...(input !== undefined ? { input } : {}),
        ...(output !== undefined ? { output } : {}),
        ...(total !== undefined ? { total } : {}),
      }
}

function addTokens(left: TokenUsage | undefined, right: TokenUsage | undefined): TokenUsage | undefined {
  if (!left && !right) return undefined
  return {
    input: (left?.input ?? 0) + (right?.input ?? 0),
    output: (left?.output ?? 0) + (right?.output ?? 0),
    total: (left?.total ?? 0) + (right?.total ?? 0),
  }
}

function phaseName(value: string): string {
  const normalized = value.replaceAll('_', '-').toLowerCase()
  const aliases: Record<string, string> = {
    image: 'image-search',
    'image-search': 'image-search',
    'classify-images': 'classify_images',
    description: 'descriptions',
    maps: 'locations',
    classification: 'tags',
    scrape: 'links',
    serp: 'discover',
  }
  return aliases[normalized] ?? normalized
}

function phaseResults(target: CurationJobTarget): PhaseResult[] {
  if (!Array.isArray(target.phase_results)) return []
  return target.phase_results.flatMap((value) => {
    const source = record(value)
    if (!source) return []
    const phase = typeof source.phase === 'string' ? source.phase : null
    if (!phase) return []
    return [
      {
        phase: phaseName(phase),
        status: typeof source.status === 'string' ? source.status : 'unknown',
        durationMs: finiteNumber(source.durationMs) ?? 0,
        ...(typeof source.error === 'string' ? { error: sanitizeJobError(source.error) } : {}),
        ...(typeof source.detail === 'string' ? { detail: source.detail.slice(0, 1_000) } : {}),
      },
    ]
  })
}

function targetLabel(target: CurationJobTarget | undefined): string | undefined {
  return target?.brand_slug ?? target?.brand_name
}

function targetForRow(
  row: { brand_id: string | null; submission_id: string | null },
  targetById: Map<string, CurationJobTarget>,
): CurationJobTarget | undefined {
  const id = row.brand_id ?? row.submission_id
  return id ? targetById.get(id) : undefined
}

function aiEvent(row: AiAuditRow, targetById: Map<string, CurationJobTarget>, gaps: string[]): StepEvent {
  const usage = tokenUsage(row.usage) ?? tokenUsage(row.response_usage)
  if (!usage) gaps.push(`AI audit row ${row.id} has no token usage`)
  const target = targetForRow(row, targetById)
  const error = typeof row.audit_error === 'string' ? sanitizeJobError(row.audit_error) : undefined

  return {
    timestamp: row.created_at,
    actor: 'LLM',
    name: row.phase,
    summary: `${row.model} ${row.phase} call${row.attempt && row.attempt > 1 ? ` (attempt ${row.attempt})` : ''}`,
    status: row.audit_ok === false ? 'error' : 'ok',
    model: row.model,
    ...(usage ? { tokens: usage } : {}),
    ...(row.latency_ms !== null ? { latencyMs: row.latency_ms } : {}),
    ...(targetLabel(target) ? { labels: { target: targetLabel(target)! } } : {}),
    ...(error ? { error } : {}),
  }
}

function searchEvent(row: SearchAuditRow, targetById: Map<string, CurationJobTarget>): StepEvent {
  const target = targetForRow(row, targetById)
  const callStatus = row.call_status ?? 'succeeded'
  const status =
    callStatus === 'succeeded' ? 'ok' : callStatus === 'empty' || callStatus === 'started' ? 'warning' : 'error'
  const labels = {
    ...(targetLabel(target) ? { target: targetLabel(target)! } : {}),
    ...(row.http_status !== null && row.http_status !== undefined ? { httpStatus: String(row.http_status) } : {}),
  }
  return {
    timestamp: row.created_at,
    actor: 'HTTP',
    name: row.search_type,
    summary: `${row.query} (${callStatus})`,
    status,
    ...(row.latency_ms !== null ? { latencyMs: row.latency_ms } : {}),
    ...(Object.keys(labels).length > 0 ? { labels } : {}),
    ...(row.urls?.at(0) ? { payloadRef: row.urls.at(0) } : {}),
    ...(row.error ? { error: sanitizeJobError(row.error) } : {}),
  }
}

function stepEvent(target: CurationJobTarget, result: PhaseResult): StepEvent {
  return {
    timestamp: target.completed_at ?? target.started_at ?? target.created_at,
    actor: result.phase === 'persist' ? 'DB' : 'SCRIPT',
    name: result.phase,
    summary: result.detail ?? `${target.brand_name}: ${result.status}`,
    status: result.status === 'failed' ? 'error' : result.status === 'succeeded' ? 'ok' : 'warning',
    latencyMs: result.durationMs,
    labels: { target: targetLabel(target) ?? target.target_id },
    ...(result.error ? { error: result.error } : {}),
  }
}

function aggregatePhaseStatus(results: PhaseResult[], events: StepEvent[]): PhaseStatus {
  if (results.some((result) => result.status === 'failed') || events.some((event) => event.status === 'error'))
    return 'failed'
  if (results.some((result) => result.status === 'succeeded') || events.some((event) => event.status === 'ok'))
    return 'succeeded'
  if (results.some((result) => result.status === 'skipped')) return 'skipped'
  if (results.some((result) => result.status === 'running')) return 'running'
  return 'unknown'
}

function capEvents(events: StepEvent[]): {
  events: StepEvent[]
  eventsTruncated?: number
} {
  if (events.length <= MAX_EVENTS_PER_PHASE) return { events }
  const errors = events.filter((event) => event.status === 'error')
  const remaining = events
    .filter((event) => event.status !== 'error')
    .toSorted((left, right) => (right.timestamp ?? '').localeCompare(left.timestamp ?? ''))
  return {
    events: [...errors, ...remaining].slice(0, MAX_EVENTS_PER_PHASE),
    eventsTruncated: events.length - MAX_EVENTS_PER_PHASE,
  }
}

async function queryByJob(table: string, columns: string, jobId: string): Promise<JobAuditQueryResult> {
  const client = createServiceClient() as unknown as AuditClient
  const { data, error } = await client
    .from(table)
    .select(columns)
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
  if (error) {
    if (isMissingJobIdColumn(error)) return { rows: [], jobIdColumnMissing: true }
    throw error
  }
  return { rows: data ?? [], jobIdColumnMissing: false }
}

async function queryLegacy(
  table: string,
  columns: string,
  targets: CurationJobTarget[],
  startedAt: string,
  completedAt: string,
): Promise<unknown[]> {
  const client = createServiceClient() as unknown as AuditClient
  const queries: AuditQuery[] = []
  for (const targetType of ['brand', 'submission'] as const) {
    const ids = targets.filter((target) => target.target_type === targetType).map((target) => target.target_id)
    const foreignKey = targetType === 'brand' ? 'brand_id' : 'submission_id'
    for (let index = 0; index < ids.length; index += LEGACY_QUERY_CHUNK_SIZE) {
      queries.push(
        client
          .from(table)
          .select(columns)
          .in(foreignKey, ids.slice(index, index + LEGACY_QUERY_CHUNK_SIZE))
          .gte('created_at', startedAt)
          .lte('created_at', completedAt)
          .order('created_at', { ascending: true }),
      )
    }
  }

  const rows: unknown[] = []
  for (const { data, error } of await Promise.all(queries)) {
    if (error) throw error
    rows.push(...(data ?? []))
  }

  const seen = new Set<string>()
  return rows.filter((value) => {
    const id = record(value)?.id
    if (typeof id !== 'string' || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

const AI_COLUMNS =
  'id, brand_id, submission_id, phase, model, latency_ms, created_at, attempt, usage:raw_response->usage, response_usage:raw_response->response->usage, audit_ok:raw_response->ok, audit_error:raw_response->error'
const SEARCH_COLUMNS =
  'id, brand_id, submission_id, search_type, query, urls, latency_ms, created_at, provider, endpoint, input, call_status, http_status, error, attempt'

export async function exportJobRunLog(jobId: string): Promise<RunLog> {
  const [job, targets, aiQuery, searchQuery] = await Promise.all([
    getCurationJob(jobId),
    listCurationJobTargets(jobId),
    queryByJob('brand_ai_results', AI_COLUMNS, jobId),
    queryByJob('brand_search_results', SEARCH_COLUMNS, jobId),
  ])
  const gaps: string[] = []
  const directAiRows = aiQuery.rows
  const directSearchRows = searchQuery.rows
  if (aiQuery.jobIdColumnMissing || searchQuery.jobIdColumnMissing) {
    gaps.push(
      'Job-scoped audit columns are unavailable; using the legacy fallback until the job_id migration is applied',
    )
  }
  const startedAt = job.started_at ?? job.created_at ?? new Date(0).toISOString()
  const completedAt = job.completed_at ?? new Date().toISOString()
  const aiRows = (
    directAiRows.length > 0
      ? directAiRows
      : await queryLegacy('brand_ai_results', AI_COLUMNS, targets, startedAt, completedAt)
  ) as AiAuditRow[]
  const searchRows = (
    directSearchRows.length > 0
      ? directSearchRows
      : await queryLegacy('brand_search_results', SEARCH_COLUMNS, targets, startedAt, completedAt)
  ) as SearchAuditRow[]
  if (directAiRows.length === 0 && aiRows.length > 0)
    gaps.push('AI audit rows were loaded through the legacy target/time-window fallback')
  if (directSearchRows.length === 0 && searchRows.length > 0)
    gaps.push('Search audit rows were loaded through the legacy target/time-window fallback')

  const targetById = new Map(targets.map((target) => [target.target_id, target]))
  const resultsByPhase = new Map<string, Array<{ target: CurationJobTarget; result: PhaseResult }>>()
  for (const target of targets) {
    for (const result of phaseResults(target)) {
      const entries = resultsByPhase.get(result.phase) ?? []
      entries.push({ target, result })
      resultsByPhase.set(result.phase, entries)
    }
  }

  const aiEventsByPhase = new Map<string, StepEvent[]>()
  let totalTokens: TokenUsage | undefined
  for (const row of aiRows) {
    const name = phaseName(row.phase)
    const event = aiEvent(row, targetById, gaps)
    aiEventsByPhase.set(name, [...(aiEventsByPhase.get(name) ?? []), event])
    totalTokens = addTokens(totalTokens, event.tokens)
  }
  const searchEventsByPhase = new Map<string, StepEvent[]>()
  for (const row of searchRows) {
    const name = phaseName(row.search_type)
    searchEventsByPhase.set(name, [...(searchEventsByPhase.get(name) ?? []), searchEvent(row, targetById)])
  }

  const phaseNames = new Set([...resultsByPhase.keys(), ...aiEventsByPhase.keys(), ...searchEventsByPhase.keys()])
  const orderedPhaseNames = [...phaseNames].toSorted((left, right) => {
    const leftIndex = PHASE_ORDER.indexOf(left as (typeof PHASE_ORDER)[number])
    const rightIndex = PHASE_ORDER.indexOf(right as (typeof PHASE_ORDER)[number])
    return (
      (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
      (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
    )
  })
  const phases: Phase[] = orderedPhaseNames.map((name, index) => {
    const entries = resultsByPhase.get(name) ?? []
    const events = [
      ...entries.map(({ target, result }) => stepEvent(target, result)),
      ...(aiEventsByPhase.get(name) ?? []),
      ...(searchEventsByPhase.get(name) ?? []),
    ]
    const durationMs = entries.reduce((total, entry) => total + entry.result.durationMs, 0)
    const phaseTokens = (aiEventsByPhase.get(name) ?? []).reduce<TokenUsage | undefined>(
      (total, event) => addTokens(total, event.tokens),
      undefined,
    )
    const capped = capEvents(events)
    return {
      index: index + 1,
      name,
      kind: PHASE_KIND[name] ?? 'unknown',
      status: aggregatePhaseStatus(
        entries.map((entry) => entry.result),
        events,
      ),
      summary: entries.length > 0 ? `Summed across ${entries.length} targets` : undefined,
      durationMs,
      barWeight: durationMs,
      ...(phaseTokens ? { tokens: phaseTokens } : {}),
      ...capped,
    }
  })

  const durationMs = job.started_at
    ? Math.max(0, new Date(job.completed_at ?? Date.now()).getTime() - new Date(job.started_at).getTime())
    : undefined
  const runStatus = ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(job.status)
    ? (job.status as RunLog['run']['status'])
    : 'unknown'

  return {
    schemaVersion: '1.0',
    run: {
      id: job.id,
      workflow: job.operation,
      trigger: job.trigger,
      actor: job.started_by,
      status: runStatus,
      ...(job.started_at ? { startedAt: job.started_at } : {}),
      ...(job.completed_at ? { completedAt: job.completed_at } : {}),
      ...(job.job_error ? { error: sanitizeJobError(job.job_error) } : {}),
      attempt: job.attempt,
      ...(job.parent_job_id ? { parentRunId: job.parent_job_id } : {}),
    },
    summary: {
      ...(durationMs !== undefined ? { durationMs } : {}),
      phaseCount: phases.length,
      callCount: aiRows.length,
      queryCount: searchRows.length,
      ...(totalTokens ? { tokens: totalTokens } : {}),
      outcomes: {
        succeeded: job.succeeded_count,
        skipped: job.skipped_count,
        failed: job.failed_count,
      },
      extraChips: [{ label: 'Targets', value: String(job.target_total) }],
    },
    phases,
    provenance: {
      producer: {
        name: 'formoria/runlog-export',
        version: process.env.npm_package_version ?? '0.1.0',
      },
      components: [
        {
          name: 'enrich-pipeline',
          version: process.env.RAILWAY_GIT_COMMIT_SHA ?? 'dev',
        },
      ],
      sourceRef: job.id,
      generatedAt: new Date().toISOString(),
    },
    ...(gaps.length > 0 ? { gaps } : {}),
  }
}
