import { describe, it, expect } from 'vitest'
import { buildReportRecord, enrichDisputeRows } from '@/lib/services/reports'

describe('buildReportRecord', () => {
  it('maps all fields to snake_case', () => {
    const result = buildReportRecord({
      brandId: 'brand-uuid-123',
      reason: 'not_mit',
      notes: 'Brand makes products in China',
    })
    expect(result).toEqual({
      brand_id: 'brand-uuid-123',
      reason: 'not_mit',
      notes: 'Brand makes products in China',
      user_id: null,
    })
  })

  it('coerces undefined notes to null', () => {
    const result = buildReportRecord({ brandId: 'brand-uuid-123', reason: 'broken_link' })
    expect(result.notes).toBeNull()
  })

  it('preserves explicit null notes', () => {
    const result = buildReportRecord({ brandId: 'brand-uuid-123', reason: 'incorrect_info', notes: null })
    expect(result.notes).toBeNull()
  })

  it('preserves non-null notes', () => {
    const result = buildReportRecord({ brandId: 'b1', reason: 'inappropriate', notes: 'Spam content' })
    expect(result.notes).toBe('Spam content')
  })

  it('carries userId into the record for ownership disputes', () => {
    const result = buildReportRecord({
      brandId: 'brand-uuid-123',
      reason: 'ownership_dispute',
      notes: '我是品牌登記負責人',
      userId: 'user-uuid-9',
    })
    expect(result.reason).toBe('ownership_dispute')
    expect(result.user_id).toBe('user-uuid-9')
  })

  it('defaults user_id to null for anonymous reasons', () => {
    const result = buildReportRecord({ brandId: 'brand-uuid-123', reason: 'broken_link' })
    expect(result.user_id).toBeNull()
  })
})

describe('enrichDisputeRows', () => {
  it('attaches reporter email and ownership status to dispute rows only', async () => {
    const rows = [
      { id: 'r1', reason: 'ownership_dispute', user_id: 'user-uuid-9', brand_id: 'b1' },
      { id: 'r2', reason: 'broken_link', user_id: null, brand_id: 'b2' },
    ]
    const enriched = await enrichDisputeRows(rows, {
      getEmail: async (id) => (id === 'user-uuid-9' ? 'mei.lin@example.com' : null),
      getOwnedBrandIds: async () => new Set(['b1']),
    })
    expect(enriched[0]).toMatchObject({ reporterEmail: 'mei.lin@example.com', brandHasOwner: true })
    expect(enriched[1].reporterEmail).toBeUndefined()
  })
})
