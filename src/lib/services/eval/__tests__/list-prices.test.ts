import { describe, expect, it } from 'vitest'
import { EVAL_LIST_PRICES, listPriceCost } from '../list-prices'

const M = 1_000_000

describe('listPriceCost', () => {
  it('prices uncached, cached, cache-write and output separately', () => {
    // Cache-write tokens are a subset of prompt_tokens (2026-09-29 probe), so
    // 1M uncached + 1M cached + 1M cache-write is a 3M prompt.
    const cost = listPriceCost(
      { promptTokens: 3 * M, cachedPromptTokens: M, cacheWriteTokens: M, completionTokens: M },
      'gpt-6-luna',
    )
    // 0.10 uncached + 0.01 cached + 0.125 cache write + 0.50 output
    expect(cost).toBeCloseTo(0.735, 6)
  })

  it('treats absent cached and cache-write counts as zero', () => {
    const cost = listPriceCost({ promptTokens: M, completionTokens: 0 }, 'gpt-6-luna')
    expect(cost).toBeCloseTo(EVAL_LIST_PRICES['gpt-6-luna']!.inputPerM, 6)
  })

  it('returns null for an unknown model', () => {
    expect(
      listPriceCost({ promptTokens: M, cachedPromptTokens: 0, cacheWriteTokens: 0, completionTokens: M }, 'no-such-model'),
    ).toBeNull()
  })
})
