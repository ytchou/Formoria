import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/services/brand-cleanup', () => ({
  cleanBrandName: vi.fn((name: string) => {
    const cleaned = name.replace(/[^\w\s-]/gu, '').trim()
    return {
      cleanedName: cleaned,
      changed: cleaned !== name,
      confidence: 'high',
      patternsMatched: cleaned !== name ? ['emoji'] : [],
    }
  }),
}))

import { suggestCleanName } from './actions'

describe('suggestCleanName', () => {
  it('returns suggestion for dirty name', async () => {
    const result = await suggestCleanName('TestBrand🥑')
    expect(result.changed).toBe(true)
    expect(result.suggestion).toBe('TestBrand')
  })

  it('returns no suggestion for clean name', async () => {
    const result = await suggestCleanName('CleanBrand')
    expect(result.changed).toBe(false)
    expect(result.suggestion).toBeNull()
  })
})

// Verify checkDuplicates is no longer exported
describe('removed exports', () => {
  it('does not export checkDuplicates', async () => {
    const mod = await import('./actions')
    expect(mod).not.toHaveProperty('checkDuplicates')
  })
})
