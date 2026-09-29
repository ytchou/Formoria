/**
 * Published list prices for models that have no `llm_model_prices` row yet
 * (DEV-1898 D15). Eval-only: the report uses these to show a `(list)` cost for
 * an arm whose DB-priced cost is unknown. Production pricing (`llm-pricing.ts`)
 * and the audit path must never import this file — a model gets a DB row only
 * when it ships (D16).
 */

export type ListPrice = {
  inputPerM: number
  cachedInputPerM: number
  cacheWritePerM: number
  outputPerM: number
}

export const EVAL_LIST_PRICES: Readonly<Record<string, ListPrice>> = {
  'gpt-6-luna': { inputPerM: 0.1, cachedInputPerM: 0.01, cacheWritePerM: 0.125, outputPerM: 0.5 },
}

/**
 * Whether `cache_write_tokens` is counted inside `prompt_tokens`. True per the
 * 2026-09-29 gpt-6-luna probe: a 1,819-token prompt reported
 * cache_write_tokens 1,816, and the identical repeat reported cached_tokens
 * 1,816 with cache_write_tokens 0 — the same prompt total both times. So the
 * uncached remainder is prompt − cached − cacheWrite. An image-input call
 * reported no cache_write_tokens at all; absent counts are treated as 0.
 */
export const CACHE_WRITE_INCLUDED_IN_PROMPT_TOKENS = true

export type TokenCounts = {
  promptTokens: number
  cachedPromptTokens?: number | null
  cacheWriteTokens?: number | null
  completionTokens: number
}

/** List-price cost in USD, or null when the model has no list price. */
export function listPriceCost(tokens: TokenCounts, model: string): number | null {
  const price = EVAL_LIST_PRICES[model]
  if (!price) return null

  const cached = tokens.cachedPromptTokens ?? 0
  const cacheWrite = tokens.cacheWriteTokens ?? 0
  // Clamped at zero, as in llm-pricing.ts: a count mismatch must never
  // produce a negative cost.
  const uncached = Math.max(
    0,
    tokens.promptTokens - cached - (CACHE_WRITE_INCLUDED_IN_PROMPT_TOKENS ? cacheWrite : 0),
  )

  return (
    (uncached / 1_000_000) * price.inputPerM +
    (cached / 1_000_000) * price.cachedInputPerM +
    (cacheWrite / 1_000_000) * price.cacheWritePerM +
    (tokens.completionTokens / 1_000_000) * price.outputPerM
  )
}
