import { createServiceClient } from '@/lib/supabase/service'
import type { Database, Json } from '@/lib/supabase/database.types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { targetForeignKey, type EnrichmentTarget } from './_shared/enrichment-target'

export type SearchType = 'serp' | 'image' | 'maps' | 'scrape'
export type SearchCallStatus =
  | 'started'
  | 'succeeded'
  | 'empty'
  | 'failed'
  | 'malformed'
  | 'timeout'
  | 'network_error'
  | 'skipped'

export type SearchAuditContext = {
  target: EnrichmentTarget
  jobId?: string
  supabase?: SupabaseClient<Database>
}

export type StartSearchAuditInput = SearchAuditContext & {
  searchType: SearchType
  provider: string
  endpoint: string
  query: string
  input: unknown
  config?: unknown
  attempt?: number
  retryAttempt?: number
  auditSpanId?: string
}

export type FinishSearchAuditInput = {
  callStatus: SearchCallStatus
  httpStatus?: number | null
  error?: string | null
  rawResponse?: unknown
  urls?: string[]
  snippets?: string[]
  latencyMs?: number | null
}

export type SearchResultRow = {
  brandId: string
  id?: string
  searchType: SearchType
  query: string
  urls: string[]
  snippets: string[]
  provider?: string
  endpoint?: string | null
  input?: unknown
  callStatus?: SearchCallStatus
  httpStatus?: number | null
  error?: string | null
  attempt?: number
  retryAttempt?: number
  rawResponse?: unknown
  latencyMs?: number | null
  createdAt?: string
}

function asJson(value: unknown): Json | null {
  return value === undefined ? null : (value as Json)
}

function getAuditClient(supabase?: SupabaseClient<Database>) {
  return supabase ?? createServiceClient()
}

/** Insert the row before the external request. This error is intentionally not swallowed. */
export async function startSearchAudit(input: StartSearchAuditInput): Promise<string> {
  const supabase = getAuditClient(input.supabase)
  const target = targetForeignKey(input.target)
  const payload = {
    ...target,
    provider: input.provider,
    endpoint: input.endpoint,
    input: asJson(input.input),
    call_status: 'started',
    http_status: null,
    error: null,
    attempt: input.attempt ?? 1,
    retry_attempt: input.retryAttempt ?? 0,
    job_id: input.jobId ?? null,
    search_type: input.searchType,
    query: input.query,
    urls: [],
    snippets: [],
    raw_response: null,
    config: asJson(input.config),
    latency_ms: null,
    audit_span_id: input.auditSpanId ?? null,
  }
  const { data, error } = await supabase
    .from('brand_search_results')
    .insert(payload)
    .select('id')
    .single()

  if (error || !data?.id) {
    throw new Error(`Failed to start ${input.provider} ${input.searchType} audit: ${error?.message ?? 'missing audit id'}`)
  }

  return data.id
}

export async function finishSearchAudit(
  id: string,
  input: FinishSearchAuditInput & { supabase?: SupabaseClient<Database> },
): Promise<void> {
  const { error } = await getAuditClient(input.supabase)
    .from('brand_search_results')
    .update({
      call_status: input.callStatus,
      http_status: input.httpStatus ?? null,
      error: input.error ?? null,
      raw_response: asJson(input.rawResponse),
      urls: input.urls ?? [],
      snippets: input.snippets ?? [],
      latency_ms: input.latencyMs ?? null,
    })
    .eq('id', id)

  if (error) {
    throw new Error(`Failed to finish search audit ${id}: ${error.message}`)
  }
}

/**
 * Latest row per target, newest first. `queryKind` narrows the replay to rows
 * written by one kind of query: the acquire phase now issues both a brand-name
 * search and a handle-anchored one, and replaying a fresh name row in place of
 * a handle row would silently skip the second search forever. Rows predating
 * the tag carry no `queryKind` and count as `'name'`. Omitting the argument
 * keeps the original behaviour (latest row of any kind).
 */
export async function getLatestSearchResults(
  targetIds: string[],
  searchType: SearchType,
  targetType: EnrichmentTarget['type'] = 'brand',
  queryKind?: 'name' | 'handle',
  client?: SupabaseClient<Database>
): Promise<Map<string, SearchResultRow>> {
  if (targetIds.length === 0) return new Map()
  const supabase = client ?? createServiceClient()
  const foreignKey = targetType === 'brand' ? 'brand_id' : 'submission_id'
  const { data, error } = await supabase
    .from('brand_search_results')
    .select(`${foreignKey}, id, search_type, query, urls, snippets, provider, endpoint, input, config, call_status, http_status, error, attempt, retry_attempt, raw_response, latency_ms, created_at`)
    .in(foreignKey, targetIds)
    .eq('search_type', searchType)
    .order('created_at', { ascending: false })

  if (error) throw error

  const results = new Map<string, SearchResultRow>()
  for (const row of data ?? []) {
    const targetId = (row as Record<string, unknown>)[foreignKey]
    if (typeof targetId !== 'string' || results.has(targetId)) continue
    if (queryKind) {
      const rowKind = (row.config as { queryKind?: string } | null)?.queryKind ?? 'name'
      if (rowKind !== queryKind) continue
    }
    results.set(targetId, {
      brandId: targetId,
      id: typeof row.id === 'string' ? row.id : undefined,
      searchType: row.search_type as SearchType,
      query: row.query,
      urls: row.urls ?? [],
      snippets: row.snippets ?? [],
      provider: typeof row.provider === 'string' ? row.provider : undefined,
      endpoint: typeof row.endpoint === 'string' ? row.endpoint : null,
      input: row.input,
      callStatus: row.call_status as SearchCallStatus,
      httpStatus: typeof row.http_status === 'number' ? row.http_status : null,
      error: typeof row.error === 'string' ? row.error : null,
      attempt: typeof row.attempt === 'number' ? row.attempt : undefined,
      retryAttempt: typeof row.retry_attempt === 'number' ? row.retry_attempt : undefined,
      rawResponse: row.raw_response,
      latencyMs: typeof row.latency_ms === 'number' ? row.latency_ms : null,
      createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
    })
  }
  return results
}

/**
 * True when a cached search result is recent enough to reuse and actually
 * carries URLs. A row with zero URLs is never fresh — it represents a search
 * that found nothing, and replaying it would skip a brand that might have
 * results now.
 */
export function isFreshSearchResult(
  row: SearchResultRow,
  maxAgeMs: number,
  now = Date.now(),
): boolean {
  if (!row.createdAt) return false
  if (row.urls.length === 0) return false
  const age = now - new Date(row.createdAt).getTime()
  return age <= maxAgeMs
}
