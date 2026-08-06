import { describe, it, expect } from 'vitest'
import { buildReviewUpdate } from './review-status'

describe('buildReviewUpdate', () => {
  it('sets status and an ISO reviewed_at for a "reviewed" decision', () => {
    const update = buildReviewUpdate('reviewed')
    expect(update.status).toBe('reviewed')
    expect(typeof update.reviewed_at).toBe('string')
    // round-trips as a valid ISO 8601 timestamp
    expect(new Date(update.reviewed_at as string).toISOString()).toBe(update.reviewed_at)
  })

  it('sets status and OMITS reviewed_at for a "dismissed" decision', () => {
    const update = buildReviewUpdate('dismissed')
    expect(update).toEqual({ status: 'dismissed' })
    expect('reviewed_at' in update).toBe(false)
  })

  it('includes reviewer fields when supplied', () => {
    const update = buildReviewUpdate('reviewed', {
      reviewerId: '11111111-2222-3333-4444-555555555555',
      notes: 'Duplicate of an earlier report.',
    })
    expect(update.reviewed_by).toBe('11111111-2222-3333-4444-555555555555')
    expect(update.reviewer_notes).toBe('Duplicate of an earlier report.')
    expect(update.status).toBe('reviewed')
  })

  it('omits reviewer fields when not supplied', () => {
    const update = buildReviewUpdate('reviewed')
    expect('reviewed_by' in update).toBe(false)
    expect('reviewer_notes' in update).toBe(false)

    // an empty attribution object is equivalent to passing nothing
    const empty = buildReviewUpdate('reviewed', {})
    expect('reviewed_by' in empty).toBe(false)
    expect('reviewer_notes' in empty).toBe(false)
  })

  it('still omits reviewed_at on dismissed, even with attribution', () => {
    const update = buildReviewUpdate('dismissed', {
      reviewerId: '11111111-2222-3333-4444-555555555555',
      notes: 'Not actionable.',
    })
    expect('reviewed_at' in update).toBe(false)
    expect(update).toEqual({
      status: 'dismissed',
      reviewed_by: '11111111-2222-3333-4444-555555555555',
      reviewer_notes: 'Not actionable.',
    })
  })
})
