export type ReviewStatus = 'pending' | 'reviewed' | 'dismissed'

export type ReviewDecision = 'reviewed' | 'dismissed'

/** Optional reviewer attribution recorded alongside a review decision. */
export type ReviewAttribution = {
  reviewerId?: string
  notes?: string
}

export function buildReviewUpdate(
  decision: ReviewDecision,
  attribution?: ReviewAttribution
): Record<string, unknown> {
  const update: Record<string, unknown> = { status: decision }

  // Deliberate: reviewed_at is written ONLY for 'reviewed' — never written as null on 'dismissed'.
  if (decision === 'reviewed') {
    update.reviewed_at = new Date().toISOString()
  }

  if (attribution?.reviewerId !== undefined) {
    update.reviewed_by = attribution.reviewerId
  }

  if (attribution?.notes !== undefined) {
    update.reviewer_notes = attribution.notes
  }

  return update
}
