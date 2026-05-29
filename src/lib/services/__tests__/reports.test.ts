import { describe, it, expect } from 'vitest'
import { buildReportRecord } from '../reports'

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
})
