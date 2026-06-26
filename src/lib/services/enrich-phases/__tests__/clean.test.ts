import { describe, expect, it } from 'vitest'
import { runCleanPhase } from '../clean'
import type { EnrichBrand, EnrichPhase } from '../types'

const brand = (name: string): EnrichBrand => ({
  id: 'brand-1',
  slug: 'test-brand',
  name,
})

describe('runCleanPhase', () => {
  it('returns succeeded with changedFields when name is cleaned', async () => {
    const result = await runCleanPhase(
      brand('  Test Brand  '),
      ['clean'] as EnrichPhase[]
    )

    expect(result.phaseResult.status).toBe('succeeded')
    expect(result.phaseResult.changedFields).toEqual(['name'])
    expect(result.patch).toEqual({ name: 'Test Brand' })
  })

  it('returns skipped when clean is not in requested phases', async () => {
    const result = await runCleanPhase(
      brand('  Test Brand Inc.  '),
      ['links'] as EnrichPhase[]
    )

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.phaseResult.changedFields).toEqual([])
    expect(result.patch).toEqual({})
  })

  it('returns succeeded with empty changedFields when name needs no cleaning', async () => {
    const result = await runCleanPhase(
      brand('Test Brand'),
      ['clean'] as EnrichPhase[]
    )

    expect(result.phaseResult.status).toBe('succeeded')
    expect(result.phaseResult.changedFields).toEqual([])
    expect(result.patch).toEqual({})
  })
})
