import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetAuditEmitterForTests, setAuditWriteSeam, type AuditRecord } from '@/lib/audit'
import { runCleanPhase } from '../clean'
import type { EnrichBrand, EnrichPhase } from '../types'

const brand = (name: string): EnrichBrand => ({
  id: 'brand-1',
  slug: 'test-brand',
  name,
})

let writes: AuditRecord[] = []

beforeEach(() => {
  writes = []
  setAuditWriteSeam(async (record) => {
    writes.push(record)
    return null
  })
})

afterEach(() => {
  resetAuditEmitterForTests()
})

describe('runCleanPhase', () => {
  it('reports success and changed name when whitespace is trimmed', async () => {
    const result = await runCleanPhase(
      brand('  Test Brand  '),
      ['clean'] as EnrichPhase[]
    )

    expect(result.phaseResult.status).toBe('succeeded')
    expect(result.phaseResult.changedFields).toEqual(['name'])
    expect(result.cleanedName).toBe('Test Brand')
  })

  it('returns skipped when clean is not in requested phases', async () => {
    const result = await runCleanPhase(
      brand('  Test Brand Inc.  '),
      ['links'] as EnrichPhase[]
    )

    expect(result.phaseResult.status).toBe('skipped')
    expect(result.phaseResult.changedFields).toEqual([])
    expect(result.cleanedName).toBeNull()
  })

  it('returns succeeded with empty changedFields when name needs no cleaning', async () => {
    const result = await runCleanPhase(
      brand('Test Brand'),
      ['clean'] as EnrichPhase[]
    )

    expect(result.phaseResult.status).toBe('succeeded')
    expect(result.phaseResult.changedFields).toEqual([])
    expect(result.cleanedName).toBeNull()
  })

  it('does not emit an audit span when clean is not requested', async () => {
    await runCleanPhase(brand('Test Brand'), ['links'] as EnrichPhase[])

    expect(writes).toHaveLength(0)
  })
})
