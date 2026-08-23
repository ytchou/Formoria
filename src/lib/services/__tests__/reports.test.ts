import { describe, it, expect, vi } from 'vitest'
import {
  buildReportRecord,
  enrichReporterRows,
  updateReportStatus,
  type UpdateReportStatusDeps,
} from '@/lib/services/reports'

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
  it('attaches reporter email to authenticated reports only', async () => {
    const rows = [
      { id: 'r1', reason: 'ownership_dispute', user_id: 'user-uuid-9', brand_id: 'b1' },
      { id: 'r2', reason: 'removal_request', user_id: 'user-uuid-10', brand_id: 'b2' },
      { id: 'r3', reason: 'broken_link', user_id: null, brand_id: 'b3' },
    ]
    const enriched = await enrichReporterRows(rows, {
      getEmail: async (id) => id === 'user-uuid-9' ? 'mei.lin@example.com' : 'owner@example.com',
    })
    expect(enriched[0]).toMatchObject({ reporterEmail: 'mei.lin@example.com' })
    expect(enriched[1]).toMatchObject({ reporterEmail: 'owner@example.com' })
    expect(enriched[2].reporterEmail).toBeUndefined()
  })
})

describe('updateReportStatus', () => {
  it('updateReportStatus refuses an already-decided report', async () => {
    const claim = vi.fn(async () => ({ data: null, error: null }))
    const deps: UpdateReportStatusDeps = { claim }

    const result = await updateReportStatus(
      '4f2a9d31-8b67-4c05-ae19-7d3f6b2c1a80',
      'reviewed',
      undefined,
      deps,
    )

    expect(result).toEqual({ ok: false, code: 'already_reviewed' })
    expect(result).not.toEqual({ ok: true })
    expect(claim).toHaveBeenCalledTimes(1)
  })

  it('returns success when the pending report is claimed', async () => {
    const claim = vi.fn(async () => ({
      data: { id: '5a3b8e42-9c78-4d16-bf20-8e4a7c3d2b91' },
      error: null,
    }))
    const deps: UpdateReportStatusDeps = { claim }

    const result = await updateReportStatus(
      '5a3b8e42-9c78-4d16-bf20-8e4a7c3d2b91',
      'dismissed',
      { reviewerId: '6b4c9f53-ad89-4e27-c031-9f5b8d4e3c02' },
      deps,
    )

    expect(result).toEqual({ ok: true })
  })

  it('reports a database error rather than a review conflict', async () => {
    const claim = vi.fn(async () => ({
      data: null,
      error: { code: '22P02', message: 'invalid input syntax for type uuid' },
    }))
    const deps: UpdateReportStatusDeps = { claim }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await updateReportStatus(
      '7c5d0a64-be9a-4f38-9142-a06c9e5f4d13',
      'reviewed',
      undefined,
      deps,
    )

    expect(result).toEqual({ ok: false, code: 'database_error' })
    // The underlying error must not be discarded — that was the whole defect.
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
