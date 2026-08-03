import { describe, expect, it } from 'vitest'
import { costFromUsage, selectPrice, usageFromRawResponse, type PriceRow } from './llm-pricing'

const LUNA: PriceRow = {
  model: 'gpt-5.6-luna',
  input_per_m: 0.2,
  cached_input_per_m: 0.02,
  output_per_m: 1.2,
  effective_from: '2026-01-01T00:00:00Z',
}

const MINI: PriceRow = {
  model: 'gpt-4o-mini',
  input_per_m: 0.15,
  cached_input_per_m: 0.075,
  output_per_m: 0.6,
  effective_from: '2026-01-01T00:00:00Z',
}

describe('costFromUsage', () => {
  it('prices uncached input, cached input, and output separately', () => {
    const cost = costFromUsage(
      { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, prompt_tokens_details: { cached_tokens: 0 } },
      LUNA
    )
    expect(cost.costUsd).toBeCloseTo(0.2 + 1.2, 6)
  })

  it('treats prompt_tokens as inclusive of cached tokens, not additional to them', () => {
    // 1M prompt of which 500k cached => 500k at 0.20 + 500k at 0.02.
    // Reading prompt_tokens as the uncached remainder would bill 1M + 500k and
    // overstate this call by 50%.
    const cost = costFromUsage(
      { prompt_tokens: 1_000_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 500_000 } },
      LUNA
    )
    expect(cost.costUsd).toBeCloseTo(0.1 + 0.01, 6)
    expect(cost.promptTokens).toBe(1_000_000)
    expect(cost.cachedPromptTokens).toBe(500_000)
  })

  it('never returns a negative cost when cached exceeds prompt', () => {
    const cost = costFromUsage(
      { prompt_tokens: 100, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 5_000 } },
      LUNA
    )
    expect(cost.costUsd).toBeGreaterThanOrEqual(0)
  })

  it('reports unknown cost as null rather than zero when no price is on file', () => {
    const cost = costFromUsage({ prompt_tokens: 10_000, completion_tokens: 500 }, null)
    expect(cost.costUsd).toBeNull()
    expect(cost.promptTokens).toBe(10_000)
  })

  it('defaults missing cached_tokens to zero', () => {
    const cost = costFromUsage({ prompt_tokens: 1_000_000, completion_tokens: 0 }, MINI)
    expect(cost.cachedPromptTokens).toBe(0)
    expect(cost.costUsd).toBeCloseTo(0.15, 6)
  })
})

describe('selectPrice', () => {
  const older: PriceRow = { ...LUNA, input_per_m: 1, effective_from: '2026-01-01T00:00:00Z' }
  const newer: PriceRow = { ...LUNA, input_per_m: 2, effective_from: '2026-06-01T00:00:00Z' }

  it('picks the newest rate not in the future relative to the call', () => {
    expect(selectPrice([older, newer], 'gpt-5.6-luna', new Date('2026-03-01'))?.input_per_m).toBe(1)
    expect(selectPrice([older, newer], 'gpt-5.6-luna', new Date('2026-07-01'))?.input_per_m).toBe(2)
  })

  it('returns null for a model with no price row', () => {
    expect(selectPrice([older], 'deepseek-v4-flash', new Date('2026-07-01'))).toBeNull()
  })
})

describe('usageFromRawResponse', () => {
  it('reads the hoisted usage on the audit envelope', () => {
    expect(usageFromRawResponse({ usage: { prompt_tokens: 5 } })?.prompt_tokens).toBe(5)
  })

  it('falls back to the nested response usage', () => {
    expect(usageFromRawResponse({ response: { usage: { prompt_tokens: 7 } } })?.prompt_tokens).toBe(7)
  })

  it('returns null for a failed call carrying no usage', () => {
    expect(usageFromRawResponse({ ok: false, status: 429 })).toBeNull()
  })
})
