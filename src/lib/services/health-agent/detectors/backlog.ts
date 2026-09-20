/**
 * Backlog detector — monitors pending submissions, moderation flags, and
 * corrections for items older than their respective thresholds.
 *
 * Owner-approved exception to the breakage-only rule: backlog age is
 * operational health, not a code breakage signal. It surfaces items
 * that need human attention.
 */

import { stableFingerprint, type HealthFinding } from '../contracts'
import type { Detector, DetectorContext } from '../types'
import { pagedRead, type PageableQuery } from '../paged-read'

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const SUBMISSIONS_THRESHOLD_DAYS = 7
const MODERATION_THRESHOLD_DAYS = 7
const CORRECTIONS_THRESHOLD_DAYS = 14

const DAY_MS = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

type SubmissionRow = { id: string; status: string; submitted_at: string | null }
type ModerationRow = { id: string; status: string; created_at: string }
type CorrectionRow = { id: string; status: string; created_at: string }

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export const backlogDetector: Detector = {
  name: 'backlog-health',
  source: 'backlog',
  schedule: 'nightly',
  severity: 'low',
  thresholds: {
    submissionsThresholdDays: SUBMISSIONS_THRESHOLD_DAYS,
    moderationThresholdDays: MODERATION_THRESHOLD_DAYS,
    correctionsThresholdDays: CORRECTIONS_THRESHOLD_DAYS,
  },

  async run(ctx: DetectorContext): Promise<HealthFinding[]> {
    const supabase = ctx.deps.supabase as {
      from: (table: string) => PageableQuery<unknown>
    }
    const findings: HealthFinding[] = []
    const now = Date.now()

    // 1. Submissions pending > 7 days
    const subCutoff = new Date(
      now - SUBMISSIONS_THRESHOLD_DAYS * DAY_MS,
    ).toISOString()
    const submissions = await pagedRead<SubmissionRow>(
      supabase,
      'brand_submissions',
      {
        orderBy: [{ column: 'id' }],
        select: 'id, status, submitted_at',
        filters: [{ column: 'status', value: 'pending' }],
      },
    )
    const oldSubmissions = submissions.filter(
      (s) => s.submitted_at && s.submitted_at < subCutoff,
    )
    if (oldSubmissions.length > 0) {
      findings.push({
        source: 'backlog',
        fingerprint: stableFingerprint(
          'backlog',
          'submissions',
          ctx.date,
        ),
        title: `${oldSubmissions.length} submissions pending > ${SUBMISSIONS_THRESHOLD_DAYS} days`,
        severity: 'low',
        evidence: {
          count: oldSubmissions.length,
          thresholdDays: SUBMISSIONS_THRESHOLD_DAYS,
          sampleIds: oldSubmissions.slice(0, 5).map((s) => s.id),
        },
        mergePolicy: 'human',
      })
    }

    // 2. Moderation flags unresolved > 7 days
    const flagCutoff = new Date(
      now - MODERATION_THRESHOLD_DAYS * DAY_MS,
    ).toISOString()
    const flags = await pagedRead<ModerationRow>(
      supabase,
      'moderation_flags',
      {
        orderBy: [{ column: 'id' }],
        select: 'id, status, created_at',
        filters: [{ column: 'status', value: 'pending' }],
      },
    )
    const oldFlags = flags.filter((f) => f.created_at < flagCutoff)
    if (oldFlags.length > 0) {
      findings.push({
        source: 'backlog',
        fingerprint: stableFingerprint(
          'backlog',
          'moderation',
          ctx.date,
        ),
        title: `${oldFlags.length} moderation flags unresolved > ${MODERATION_THRESHOLD_DAYS} days`,
        severity: 'low',
        evidence: {
          count: oldFlags.length,
          thresholdDays: MODERATION_THRESHOLD_DAYS,
          sampleIds: oldFlags.slice(0, 5).map((f) => f.id),
        },
        mergePolicy: 'human',
      })
    }

    // 3. Corrections pending > 14 days
    const corrCutoff = new Date(
      now - CORRECTIONS_THRESHOLD_DAYS * DAY_MS,
    ).toISOString()
    const corrections = await pagedRead<CorrectionRow>(
      supabase,
      'brand_field_corrections',
      {
        orderBy: [{ column: 'id' }],
        select: 'id, status, created_at',
        filters: [{ column: 'status', value: 'pending' }],
      },
    )
    const oldCorrections = corrections.filter(
      (c) => c.created_at < corrCutoff,
    )
    if (oldCorrections.length > 0) {
      findings.push({
        source: 'backlog',
        fingerprint: stableFingerprint(
          'backlog',
          'corrections',
          ctx.date,
        ),
        title: `${oldCorrections.length} corrections pending > ${CORRECTIONS_THRESHOLD_DAYS} days`,
        severity: 'low',
        evidence: {
          count: oldCorrections.length,
          thresholdDays: CORRECTIONS_THRESHOLD_DAYS,
          sampleIds: oldCorrections.slice(0, 5).map((c) => c.id),
        },
        mergePolicy: 'human',
      })
    }

    return findings
  },
}
