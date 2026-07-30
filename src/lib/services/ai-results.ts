import { createServiceClient } from '@/lib/supabase/server'
import type { DescriptionAttempt } from './description-rewrite'
import { brandTarget, targetForeignKey, type EnrichmentTarget } from './enrichment-target'

const DEEPSEEK_MODEL = 'deepseek-v4-flash'

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
  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('brand_ai_results').insert({
      ...targetForeignKey(input.target),
      job_id: input.jobId ?? null,
      phase: input.phase,
      model: input.model,
      raw_response: input.rawResponse,
      input: input.input,
      attempt: input.attempt ?? null,
      config: input.config ?? null,
      latency_ms: Math.round(input.latencyMs),
    } as never)
    if (error) console.error(`  [AI-RESULTS] insertAiCallResult failed:`, error.message)
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

export type AiExpansionInput = {
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
    model: DEEPSEEK_MODEL,
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

export async function updateDescriptionAuditResult(input: {
  target: EnrichmentTarget
  jobId?: string
  attempt: DescriptionAttempt
}): Promise<void> {
  const supabase = createServiceClient()
  const targetColumn = input.target.type === 'brand' ? 'brand_id' : 'submission_id'
  let query = supabase
    .from('brand_ai_results')
    .select('id, raw_response')
    .eq(targetColumn, input.target.id)
    .eq('phase', 'description')
    .eq('attempt', input.attempt.attempt)

  query = input.jobId ? query.eq('job_id', input.jobId) : query.is('job_id', null)
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (error || !data) {
    console.error(`  [AI-RESULTS] updateDescriptionAuditResult failed:`, error?.message ?? 'audit row not found')
    return
  }

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
      price_range: parsed.priceRange,
      product_tags: parsed.productTags,
    } as never)
    .eq('id', data.id)
  if (updateError) console.error(`  [AI-RESULTS] updateDescriptionAuditResult failed:`, updateError.message)
}

export async function insertExpansionResult(input: AiExpansionInput): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('brand_ai_results').insert({
    ...targetForeignKey(input.target ?? brandTarget(input.brandId)),
    phase: 'expansion',
    model: DEEPSEEK_MODEL,
  } as never)
  if (error) console.error(`  [AI-RESULTS] insertExpansionResult failed:`, error.message)
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
    model: DEEPSEEK_MODEL,
  } as never)
  if (error) console.error(`  [AI-RESULTS] insertClassificationResult failed:`, error.message)
}
