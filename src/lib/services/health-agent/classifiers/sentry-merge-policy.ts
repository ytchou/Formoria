/**
 * Sentry merge-policy decision — given a classification, decides whether
 * the finding can be merged automatically or needs human review.
 *
 * Five veto conditions force human review. When multiple apply, all reasons
 * are accumulated into humanReason.
 */

import type { SentryClassification } from './sentry-classify'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_AUTOMATIC_CONFIDENCE = 0.7
const AUTOMATIC_FIXABILITY = ['high', 'medium'] as const

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export function decideSentryMergePolicy(classification: SentryClassification): {
  mergePolicy: 'automatic' | 'human'
  humanReason?: string
} {
  const reasons: string[] = []

  // 1. Classifier says human
  if (classification.mergePolicy === 'human') {
    reasons.push('classifier recommends human review')
  }

  // 2. Critical or high severity
  if (
    classification.severity === 'critical' ||
    classification.severity === 'high'
  ) {
    reasons.push(`${classification.severity} severity requires human review`)
  }

  // 3. Empty changedFiles
  if (classification.changedFiles.length === 0) {
    reasons.push('changedFiles is empty — no fix target identified')
  }

  // 4. Low confidence
  if (classification.confidence < MIN_AUTOMATIC_CONFIDENCE) {
    reasons.push(
      `confidence ${classification.confidence} below ${MIN_AUTOMATIC_CONFIDENCE} threshold`,
    )
  }

  // 5. Low/unknown fixability
  if (
    !(AUTOMATIC_FIXABILITY as readonly string[]).includes(
      classification.fixability,
    )
  ) {
    reasons.push(
      `fixability "${classification.fixability}" not in automatic set`,
    )
  }

  if (reasons.length > 0) {
    return { mergePolicy: 'human', humanReason: reasons.join('; ') }
  }

  return { mergePolicy: 'automatic' }
}
