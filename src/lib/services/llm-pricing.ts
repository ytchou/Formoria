import { createServiceClient } from '@/lib/supabase/server'

/**
 * Turns provider token counts into dollars.
 *
 * No LLM provider returns a cost figure, so the only way to know what a run
 * spent is to price the tokens ourselves. Rates live in `llm_model_prices`
 * rather than in this file because they change without a deploy, and because a
 * historical row must keep the rate that was live when it ran.
 */

export type TokenUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

export type PriceRow = {
  model: string
  input_per_m: number
  cached_input_per_m: number
  output_per_m: number
  effective_from: string
}

export type CostBreakdown = {
  promptTokens: number
  cachedPromptTokens: number
  completionTokens: number
  /** Null when no price is on file for the model — unknown cost, not zero cost. */
  costUsd: number | null
}

/**
 * Cached for the life of the process. A curation run makes thousands of calls
 * and the rate table changes on a human timescale, so re-reading it per call
 * would be pure overhead. A worker restart picks up new rates.
 */
let priceCache: PriceRow[] | null = null
let priceCacheLoadedAt = 0
const PRICE_TTL_MS = 15 * 60 * 1000

export function resetPriceCacheForTests(): void {
  priceCache = null
  priceCacheLoadedAt = 0
}

async function loadPrices(): Promise<PriceRow[]> {
  const fresh = priceCache !== null && Date.now() - priceCacheLoadedAt < PRICE_TTL_MS
  if (fresh) return priceCache as PriceRow[]

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('llm_model_prices')
      .select('model, input_per_m, cached_input_per_m, output_per_m, effective_from')
      .order('effective_from', { ascending: false })
    if (error) throw new Error(error.message)
    priceCache = (data ?? []) as PriceRow[]
    priceCacheLoadedAt = Date.now()
    return priceCache
  } catch (error) {
    // A pricing outage must never fail the call whose cost we were annotating.
    console.error('[llm-pricing] price load failed:', error instanceof Error ? error.message : String(error))
    return priceCache ?? []
  }
}

/** The rate in force for `model` at `at` — the newest row not in the future. */
export function selectPrice(prices: PriceRow[], model: string, at: Date): PriceRow | null {
  const candidates = prices
    .filter((p) => p.model === model && new Date(p.effective_from).getTime() <= at.getTime())
    .sort((a, b) => new Date(b.effective_from).getTime() - new Date(a.effective_from).getTime())
  return candidates.at(0) ?? null
}

export function costFromUsage(usage: TokenUsage, price: PriceRow | null): CostBreakdown {
  const promptTokens = usage.prompt_tokens ?? 0
  const cachedPromptTokens = usage.prompt_tokens_details?.cached_tokens ?? 0
  const completionTokens = usage.completion_tokens ?? 0

  if (!price) {
    return { promptTokens, cachedPromptTokens, completionTokens, costUsd: null }
  }

  // `prompt_tokens` is the provider's total and already includes the cached
  // portion, so the uncached remainder is what gets the standard rate. Clamped
  // at zero: a provider that ever reported cached > prompt would otherwise
  // produce a negative cost that silently reduces a run's total.
  const uncached = Math.max(0, promptTokens - cachedPromptTokens)
  const costUsd =
    (uncached / 1_000_000) * price.input_per_m +
    (cachedPromptTokens / 1_000_000) * price.cached_input_per_m +
    (completionTokens / 1_000_000) * price.output_per_m

  return {
    promptTokens,
    cachedPromptTokens,
    completionTokens,
    costUsd: Number(costUsd.toFixed(6)),
  }
}

export async function priceUsage(model: string, usage: TokenUsage, at: Date = new Date()): Promise<CostBreakdown> {
  return costFromUsage(usage, selectPrice(await loadPrices(), model, at))
}

/** Pulls the usage object out of the audit envelope written by llm-audit.ts. */
export function usageFromRawResponse(rawResponse: unknown): TokenUsage | null {
  if (!rawResponse || typeof rawResponse !== 'object') return null
  const envelope = rawResponse as { usage?: TokenUsage; response?: { usage?: TokenUsage } }
  return envelope.usage ?? envelope.response?.usage ?? null
}
