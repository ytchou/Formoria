import { describe, it, expect } from 'vitest'
import { buildReportRecord, enrichReporterRows } from '@/lib/services/reports'

describe('buildReportRecord', () => {
  it('maps all fields to snake_case', () => {
    const result = buildReportRecord({
      brandId: 'brand-uuid-123',
      reason: 'incorrect_info',
      notes: 'The address is outdated',
    })
    expect(result).toEqual({
      brand_id: 'brand-uuid-123',
      reason: 'incorrect_info',
      notes: 'The address is outdated',
      reported_field: null,
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

  it('carries userId into the record for removal requests', () => {
    const result = buildReportRecord({
      brandId: 'brand-uuid-123',
      reason: 'removal_request',
      notes: '請移除這個品牌頁',
      userId: 'user-uuid-10',
    })
    expect(result.reason).toBe('removal_request')
    expect(result.user_id).toBe('user-uuid-10')
  })

  it('defaults user_id to null for anonymous reasons', () => {
    const result = buildReportRecord({ brandId: 'brand-uuid-123', reason: 'broken_link' })
    expect(result.user_id).toBeNull()
  })
})

describe('enrichReporterRows', () => {
  it('attaches reporter email to authenticated reports and ownership status to disputes only', async () => {
    const rows = [
      { id: 'r1', reason: 'ownership_dispute', user_id: 'user-uuid-9', brand_id: 'b1' },
      { id: 'r2', reason: 'removal_request', user_id: 'user-uuid-10', brand_id: 'b2' },
      { id: 'r3', reason: 'broken_link', user_id: null, brand_id: 'b3' },
    ]
    const enriched = await enrichReporterRows(rows, {
      getEmail: async (id) => id === 'user-uuid-9' ? 'mei.lin@example.com' : 'owner@example.com',
      getOwnedBrandIds: async () => new Set(['b1']),
    })
    expect(enriched[0]).toMatchObject({ reporterEmail: 'mei.lin@example.com', brandHasOwner: true })
    expect(enriched[1]).toMatchObject({ reporterEmail: 'owner@example.com' })
    expect(enriched[1].brandHasOwner).toBeUndefined()
    expect(enriched[2].reporterEmail).toBeUndefined()
  })
})
