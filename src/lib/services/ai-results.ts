import { createServiceClient } from '@/lib/supabase/server'
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
      latency_ms: input.latencyMs,
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

export type AiDescriptionInput = {
  brandId: string
  target?: EnrichmentTarget
  description: string
  productType?: string | null
  confidence?: 'high' | 'medium' | 'low'
  priceRange?: number | null
  productTags?: string[]
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

export async function insertDescriptionResult(input: AiDescriptionInput): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('brand_ai_results').insert({
    ...targetForeignKey(input.target ?? brandTarget(input.brandId)),
    phase: 'description',
    description: input.description,
    product_type: input.productType ?? null,
    confidence: input.confidence ?? null,
    price_range: input.priceRange ?? null,
    product_tags: input.productTags ?? [],
    model: DEEPSEEK_MODEL,
  } as never)
  if (error) console.error(`  [AI-RESULTS] insertDescriptionResult failed:`, error.message)
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
