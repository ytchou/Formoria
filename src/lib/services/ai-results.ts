import { createServiceClient } from '@/lib/supabase/server'
import type { DescriptionAttempt } from './description-rewrite'
import type { BrandFactsAttempt } from './brand-facts'
import { brandTarget, targetForeignKey, type EnrichmentTarget } from './enrichment-target'
import { resolveOpenAIModel } from './openai-client'
import { evalSinkPath, writeEvalSinkRecord } from './eval/llm-usage-sink'
import { priceUsage, usageFromRawResponse } from './llm-pricing'
import { captureAlert } from '@/lib/adapters/alerting/sentry'

// The model behind every text phase. Written verbatim into brand_ai_results.model, so it
// must track the model the audited client actually calls — hence the shared resolver
// rather than a second literal that can drift out of step with the client's default.
//
// Called per use, never hoisted into a module-level const: at module load
// `OPENAI_MODEL_OVERRIDE` may not be set yet (a harness that sets it after
// importing this module would otherwise stamp every row with the default), and
// the resolver is a two-line env read, not a cost worth caching.
function textModel(): string {
  return resolveOpenAIModel()
}

/**
 * Postgres error codes that mean the DATABASE SCHEMA IS BEHIND THE CODE, not
 * that the write hit a transient problem: 23514 is a CHECK violation (a phase
 * value the deployed constraint has not been widened to accept) and 42703 is an
 * undefined column.
 */
const SCHEMA_MISMATCH_CODES = new Set(['23514', '42703'])
const PHASE_CHECK_MIGRATION = 'supabase/migrations/20260803033000_widen_ai_results_phase_check.sql'
const MAX_AUDIT_WRITE_ATTEMPTS = 3
const AUDIT_WRITE_RETRY_BASE_MS = 250
const TRANSIENT_DATABASE_CODES = new Set([
  '40001',
  '40P01',
  '53000',
  '53100',
  '53200',
  '53300',
  'PGRST000',
  'PGRST001',
  'PGRST002',
  'PGRST003',
])

// One shot per process. This fires on EVERY audit write once the schema is
// behind, and a per-row log would bury the line it is trying to make unmissable.
let schemaMismatchReported = false

type AuditInsertError = { code?: string; message: string }

function isTransientAuditInsertError(error: AuditInsertError): boolean {
  return !error.code || error.code.startsWith('08') || TRANSIENT_DATABASE_CODES.has(error.code)
}

export async function retryAuditWrite(
  write: () => Promise<AuditInsertError | null>,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<AuditInsertError | null> {
  for (let attempt = 1; attempt <= MAX_AUDIT_WRITE_ATTEMPTS; attempt += 1) {
    const error = await write()
    if (!error) return null
    if (!isTransientAuditInsertError(error) || attempt === MAX_AUDIT_WRITE_ATTEMPTS) return error

    const delay = AUDIT_WRITE_RETRY_BASE_MS * 2 ** (attempt - 1)
    console.error(
      `  [AI-RESULTS] transient audit write failed. Retry ${attempt}/${MAX_AUDIT_WRITE_ATTEMPTS - 1} in ${delay}ms:`,
      error.message,
    )
    await wait(delay)
  }

  return null
}

/**
 * Audit writes must never throw — an audit failure must not fail the enrichment
 * call it was recording. But a schema mismatch drops every audit AND cost row
 * for the whole run, and per project convention the code reaches production
 * ahead of its migration by default (Railway auto-deploys on push to main;
 * Supabase migrations need a manual `supabase db push`). So it must be
 * impossible to mistake for a transient error.
 */
function reportInsertError(error: { code?: string; message: string }, phase: string): void {
  if (!error.code || !SCHEMA_MISMATCH_CODES.has(error.code) || schemaMismatchReported) {
    console.error(`  [AI-RESULTS] insertAiCallResult failed:`, error.message)
    return
  }

  schemaMismatchReported = true
  const message =
    `[AI-RESULTS] SCHEMA MISMATCH: brand_ai_results rejected phase="${phase}" — ` +
    `apply ${PHASE_CHECK_MIGRATION} (supabase db push --linked --include-all). ` +
    `ALL audit and cost rows are being dropped.`
  console.error(message, error.message)
  captureAlert(message, { level: 'error', context: { phase, pgCode: error.code } })
}

export type AiCallInput = {
  target: EnrichmentTarget
  phase: string
  model: string
  jobId?: string
  rawResponse: unknown
  input: unknown
  attempt?: number
  config?: unknown
  latencyMs: number
}

export async function insertAiCallResult(input: AiCallInput): Promise<void> {
  const sink = evalSinkPath()
  if (sink) {
    writeEvalSinkRecord({
      path: sink,
      target: { type: input.target.type, id: input.target.id },
      phase: input.phase,
      model: input.model,
      latencyMs: input.latencyMs,
      rawResponse: input.rawResponse,
    })
    return
  }

  try {
    // Tokens and cost are denormalised out of raw_response at write time. They
    // are derivable from the JSONB, but only by a query that cannot use an
    // index — which makes "what did last week cost" unanswerable at scale.
    // A call with no usage (any failed request) stores nulls, not zeros:
    // zero would assert the call was free rather than unmeasured.
    const usage = usageFromRawResponse(input.rawResponse)
    const cost = usage ? await priceUsage(input.model, usage) : null

    const row = {
      ...targetForeignKey(input.target),
      job_id: input.jobId ?? null,
      phase: input.phase,
      model: input.model,
      raw_response: input.rawResponse,
      input: input.input,
      attempt: input.attempt ?? null,
      config: input.config ?? null,
      latency_ms: Math.round(input.latencyMs),
      prompt_tokens: cost?.promptTokens ?? null,
      cached_prompt_tokens: cost?.cachedPromptTokens ?? null,
      completion_tokens: cost?.completionTokens ?? null,
      cost_usd: cost?.costUsd ?? null,
    }
    const error = await retryAuditWrite(async () => {
      try {
        const { error: insertError } = await createServiceClient()
          .from('brand_ai_results')
          .insert(row as never)
        return insertError
          ? { ...(insertError.code ? { code: insertError.code } : {}), message: insertError.message }
          : null
      } catch (writeError) {
        return { message: writeError instanceof Error ? writeError.message : String(writeError) }
      }
    })
    if (error) reportInsertError(error, input.phase)
  } catch (error) {
    console.error(`  [AI-RESULTS] insertAiCallResult failed:`, error instanceof Error ? error.message : String(error))
  }
}

export type AiTriageInput = {
  brandId: string
  target?: EnrichmentTarget
  isNonBrand: boolean
  nonBrandReason: string | null
  slugGenerated: string | null
  productType: string | null
  confidence: 'high' | 'medium' | 'low'
}

export type AiReputationInput = {
  brandId: string
  target?: EnrichmentTarget
}

export async function insertTriageResult(input: AiTriageInput): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('brand_ai_results').insert({
    ...targetForeignKey(input.target ?? brandTarget(input.brandId)),
    phase: 'detect',
    is_non_brand: input.isNonBrand,
    non_brand_reason: input.nonBrandReason,
    slug_generated: input.slugGenerated,
    product_type: input.productType,
    confidence: input.confidence,
    model: textModel(),
  } as never)
  if (error) console.error(`  [AI-RESULTS] insertTriageResult failed:`, error.message)
}

export function mergeDescriptionAuditResponse(
  rawResponse: unknown,
  parsed: unknown,
  validationRejections: unknown,
): Record<string, unknown> {
  const auditResponse =
    rawResponse && typeof rawResponse === 'object' && !Array.isArray(rawResponse)
      ? rawResponse as Record<string, unknown>
      : { response: rawResponse }

  return { ...auditResponse, parsed, validationRejections }
}

/**
 * Locates the audit row the audited client already inserted for one attempt of
 * one phase. Shared by the copy and facts updaters because they differ only in
 * which denormalised columns they can fill.
 */
async function findAuditRow(
  target: EnrichmentTarget,
  phase: string,
  attempt: number,
  jobId?: string,
): Promise<{ id: string; raw_response: unknown } | null> {
  const supabase = createServiceClient()
  const targetColumn = target.type === 'brand' ? 'brand_id' : 'submission_id'
  let query = supabase
    .from('brand_ai_results')
    .select('id, raw_response')
    .eq(targetColumn, target.id)
    .eq('phase', phase)
    .eq('attempt', attempt)

  query = jobId ? query.eq('job_id', jobId) : query.is('job_id', null)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (error || !data) {
    console.error(`  [AI-RESULTS] ${phase} audit row lookup failed:`, error?.message ?? 'audit row not found')
    return null
  }
  return data
}

/**
 * Copy-call audit. `price_range` and `product_tags` are deliberately absent:
 * those fields moved to the facts call when the mega-call was split, and
 * `updateFactsAuditResult` denormalises them onto the `facts` row instead.
 */
export async function updateDescriptionAuditResult(input: {
  target: EnrichmentTarget
  jobId?: string
  attempt: DescriptionAttempt
}): Promise<void> {
  const data = await findAuditRow(input.target, 'descriptions', input.attempt.attempt, input.jobId)
  if (!data) return

  const supabase = createServiceClient()
  const parsed = input.attempt.parsed
  const { error: updateError } = await supabase
    .from('brand_ai_results')
    .update({
      raw_response: mergeDescriptionAuditResponse(
        data.raw_response,
        parsed,
        input.attempt.validationRejections,
      ),
      description: parsed.description_zh ?? null,
    } as never)
    .eq('id', data.id)
  if (updateError) console.error(`  [AI-RESULTS] updateDescriptionAuditResult failed:`, updateError.message)
}

/** Facts-call audit — carries the extraction fields the copy row no longer has. */
export async function updateFactsAuditResult(input: {
  target: EnrichmentTarget
  jobId?: string
  attempt: BrandFactsAttempt
}): Promise<void> {
  const data = await findAuditRow(input.target, 'facts', input.attempt.attempt, input.jobId)
  if (!data) return

  const supabase = createServiceClient()
  const parsed = input.attempt.parsed
  const { error: updateError } = await supabase
    .from('brand_ai_results')
    .update({
      raw_response: mergeDescriptionAuditResponse(data.raw_response, parsed, []),
      price_range: parsed.priceRange,
      product_tags: parsed.productTags,
    } as never)
    .eq('id', data.id)
  if (updateError) console.error(`  [AI-RESULTS] updateFactsAuditResult failed:`, updateError.message)
}

export async function insertReputationResult(input: AiReputationInput): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('brand_ai_results').insert({
    ...targetForeignKey(input.target ?? brandTarget(input.brandId)),
    phase: 'reputation',
    model: textModel(),
  } as never)
  if (error) console.error(`  [AI-RESULTS] insertReputationResult failed:`, error.message)
}

export type AiClassificationInput = {
  brandId: string
  target?: EnrichmentTarget
  productType: string
  confidence: 'high' | 'medium' | 'low'
}

export async function insertClassificationResult(input: AiClassificationInput): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('brand_ai_results').insert({
    ...targetForeignKey(input.target ?? brandTarget(input.brandId)),
    phase: 'classification',
    product_type: input.productType,
    confidence: input.confidence,
    model: textModel(),
  } as never)
  if (error) console.error(`  [AI-RESULTS] insertClassificationResult failed:`, error.message)
}
