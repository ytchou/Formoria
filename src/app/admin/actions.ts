'use server'

import { runWithAuditContext } from '@/lib/audit/context'
import { revalidatePath } from 'next/cache'
import { requireAdminAction } from '@/lib/auth/require-admin'
import { requestBrandRefresh } from '@/lib/services/submissions'
import {
  approveSubmissionWorkflow,
  commitSubmissionRejection,
  notifySubmissionRejected,
  rejectSubmissionWorkflow,
  type ApprovalResult,
} from '@/lib/services/submission-review-workflow'
import { withApprovalTimeout } from '@/lib/services/_shared/timeout'
import { deleteBrand, getBrandById, updateBrand } from '@/lib/services/brands'
import { getBrandTrailSlugs } from '@/lib/services/curated-products'
import {
  requestCuratedProductBackfill,
  type CuratedProductBackfillResult,
} from '@/lib/services/curated-products/backfill'
import { updateModerationFlagStatus } from '@/lib/services/moderation'
import { validateIdBatch } from '@/lib/validation/id-batch'
import { reviewEntityIdSchema } from '@/lib/validation/admin-review'
import { MAX_BULK_PRODUCT_BACKFILL } from '@/lib/constants/curated-products'
import { z } from 'zod'
import { updateReportStatus } from '@/lib/services/reports'
import {
  reviewCorrections,
  validateCorrectionBatch,
  type CorrectionBatchFailure,
  type CorrectionDecision,
} from '@/lib/services/brand-corrections'
import { reviewCommunityStockist } from '@/lib/services/stockists'
import { logAdminAction } from '@/lib/services/admin-audit'
import { DENIAL_REASONS, type DenialReason } from '@/lib/types'
import { captureServerEvent } from '@/lib/posthog-server'
import {
  revalidatePublicBrands,
  revalidatePublicStockists,
  revalidateTrail,
} from '@/lib/cache/public-brand-cache'
import { routes } from '@/lib/routes'

/**
 * ONE validator for the admin id value class, reused rather than restated.
 * `reviewEntityIdSchema` (`lib/validation/admin-review.ts`) is the declared
 * schema for it and already gates the review payload and the drop queue; this
 * file used to carry three hand-rolled copies instead, and they had drifted —
 * the named one accepted UUID versions 1-5 while two inline copies accepted
 * 1-8, so the same value was valid or invalid depending on which action
 * received it.
 */
function isAdminEntityId(value: unknown): boolean {
  return reviewEntityIdSchema.safeParse(value).success
}

type ApprovalFailure = {
  submissionId: string
  error: string
}

type ApprovalOutcome =
  | { ok: true; submissionId: string; result: ApprovalResult }
  | { ok: false; submissionId: string; error: string }

type RejectionFailure = {
  submissionId: string
  error: string
}

type RejectionOutcome =
  | { ok: true; submissionId: string }
  | { ok: false; submissionId: string; error: string }

const MAX_BULK_APPROVALS = 100
const MAX_BULK_REJECTIONS = 100
const MAX_REJECTION_ID_LENGTH = 64
const INVALID_REJECTION_BATCH_ERROR = 'Invalid bulk rejection selection'

/**
 * The admin UI emails the submitter and schedules telemetry with `after()`.
 * The operator script (`approve-ready-submissions.ts`) calls the same workflow
 * with no email and an awaited capture, since it runs outside a request.
 */
const ADMIN_APPROVAL_DEPS = {
  notify: 'send',
  captureEvent: captureServerEvent,
} as const

function revalidateApprovals(results: ApprovalResult[]): void {
  revalidatePath(routes.admin.submissions())
  revalidatePath(routes.admin.index())
  if (results.some((result) => result.refresh)) {
    revalidatePath(routes.admin.brands())
  }
  revalidatePublicBrands(results.map((result) => result.brandSlug))
  // `revalidatePublicBrands` deliberately does not cover `/discover/[slug]`;
  // the workflow returns the trails an approved refresh restored tiles to.
  for (const trailSlug of new Set(results.flatMap((result) => result.trailSlugs))) {
    revalidateTrail(trailSlug)
  }
}

/**
 * Supabase rejects with a plain `{ message, code, ... }` object, not an Error,
 * so `err instanceof Error` misses it and every failure collapsed into
 * "An unexpected error occurred" — which hid the actual cause. The messages
 * worth surfacing come from `approve_submission`'s own `raise exception` calls
 * ("Submission must satisfy publishable core before approval" and friends);
 * they are already admin-readable, so pass them through verbatim rather than
 * mapping SQLSTATEs. Admin-only surface, so raw DB text is acceptable here.
 */
function describeApprovalError(err: unknown): string {
  const candidate = err as { code?: string; message?: string } | null
  if (err instanceof Error && err.message) return err.message
  if (typeof candidate?.message === 'string' && candidate.message) {
    return candidate.message
  }
  return 'An unexpected error occurred'
}

export async function approveSubmissionAction(
  submissionId: string
): Promise<
  | {
      error?: string
      imageSyncWarning?: { synced: number; failed: number }
      storageCleanupWarning?: true
    }
  | undefined
> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      const result = await withApprovalTimeout(
        approveSubmissionWorkflow(submissionId, auth.user.id, ADMIN_APPROVAL_DEPS)
      )
      revalidateApprovals([result])

      if (result.imageSyncWarning) return { imageSyncWarning: result.imageSyncWarning }
      if (result.storageCleanupWarning) return { storageCleanupWarning: true }
      return undefined
    } catch (err) {
      console.error('[admin:approveSubmission]', err)
      return { error: describeApprovalError(err) }
    }
  });
}

export async function approveSubmissionsAction(
  submissionIds: string[]
): Promise<
  | { failures: ApprovalFailure[]; storageCleanupWarning?: true }
  | { error: string }
> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth
      if (!Array.isArray(submissionIds)) {
        return { error: 'Invalid bulk approval selection' }
      }

      const ids = [...new Set(submissionIds)]
      if (
        ids.length === 0 ||
        ids.length > MAX_BULK_APPROVALS ||
        ids.some((id) => typeof id !== 'string' || id.length === 0 || id.length > 64)
      ) {
        return { error: 'Invalid bulk approval selection' }
      }

      const outcomes = await Promise.all(
        ids.map(async (submissionId): Promise<ApprovalOutcome> => {
          try {
            return {
              ok: true,
              submissionId,
              result: await withApprovalTimeout(
                approveSubmissionWorkflow(submissionId, auth.user.id, ADMIN_APPROVAL_DEPS)
              ),
            }
          } catch (err) {
            console.error('[admin:approveSubmissions]', { submissionId, error: err })
            return {
              ok: false,
              submissionId,
              error: describeApprovalError(err),
            }
          }
        })
      )

      const successes = outcomes.flatMap((outcome) =>
        outcome.ok ? [outcome.result] : []
      )
      if (successes.length > 0) {
        try {
          revalidateApprovals(successes)
        } catch (err) {
          console.error('[admin:approveSubmissions] revalidateApprovals failed:', err)
        }
      }

      const failures = outcomes.flatMap((outcome) =>
        outcome.ok
          ? []
          : [{ submissionId: outcome.submissionId, error: outcome.error }]
      )
      return {
        failures,
        ...(successes.some((result) => result.storageCleanupWarning)
          ? { storageCleanupWarning: true as const }
          : {}),
      }
    } catch (err) {
      console.error('[admin:approveSubmissions]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}

export async function reviewCorrectionsAction(
  correctionIds: string[],
  decision: CorrectionDecision,
  notes: string
): Promise<{ failures: CorrectionBatchFailure[] } | { error: string }> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      const validated = validateCorrectionBatch(correctionIds)
      if (!validated.ok) return { error: validated.error }

      if (decision !== 'approved' && decision !== 'rejected') {
        return { error: 'Invalid correction decision' }
      }

      const result = await reviewCorrections(
        validated.ids,
        decision,
        notes,
        { reviewerId: auth.user.id }
      )
      if ('error' in result) return result

      // The admin navigation badge reads the pending correction count too.
      revalidatePath(routes.admin.corrections())
      revalidatePath(routes.admin.index())
      return result
    } catch (err) {
      console.error('[admin:reviewCorrections]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  })
}


export async function requestBrandRefreshAction(
  brandId: string
): Promise<{ submissionId: string } | { error: string }> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth
      if (!isAdminEntityId(brandId)) {
        return { error: 'Invalid brand ID' }
      }
      if (!auth.user.email) return { error: 'Admin email is required' }

      const result = await requestBrandRefresh(brandId, {
        id: auth.user.id,
        email: auth.user.email,
      })
      revalidatePath(routes.admin.brands())
      revalidatePath(routes.admin.submissions())
      revalidatePath(routes.admin.index())
      return result
    } catch (err) {
      console.error('[admin:requestBrandRefresh]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}

/**
 * Backfill entry point for generated curated products (DEV-1469): open a refresh
 * per selected brand and queue ONE curation job scoped to the products phase and
 * the two phases it depends on (see the backfill service for the derivation).
 *
 * The job is queued, not dispatched. Dispatch needs the worker URL and control
 * token, and a missing one marks the job failed — `/admin/jobs` already has a
 * dispatch button for the deliberate "run it now", and the worker's scheduled
 * pass claims a queued job either way.
 *
 * Per-brand outcomes rather than a single verdict: a brand already mid-refresh
 * raises 23505, which is an ordinary answer ("not this one, not yet") and must
 * reach the admin as a message, never as a thrown error.
 */
export async function requestCuratedProductBackfillAction(
  brandIds: string[]
): Promise<CuratedProductBackfillResult | { error: string }> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth
      if (!Array.isArray(brandIds)) {
        return { error: 'Invalid brand selection' }
      }

      const ids = [...new Set(brandIds)]
      // The cap gets its OWN message. Selecting 101 brands out of a directory
      // of 718 is an ordinary intent, not a malformed request, and returning
      // the same 'Invalid brand selection' string for both named neither the
      // limit nor the fix — the admin retried the identical selection and got
      // the identical error.
      if (ids.length > MAX_BULK_PRODUCT_BACKFILL) {
        return {
          error: `Product generation runs up to ${MAX_BULK_PRODUCT_BACKFILL} brands at a time. ${ids.length} are selected — deselect ${ids.length - MAX_BULK_PRODUCT_BACKFILL} and run the rest afterwards.`,
        }
      }
      if (!z.array(reviewEntityIdSchema).min(1).safeParse(ids).success) {
        return { error: 'Invalid brand selection' }
      }
      if (!auth.user.email) return { error: 'Admin email is required' }

      const result = await requestCuratedProductBackfill(ids, {
        id: auth.user.id,
        email: auth.user.email,
      })
      revalidatePath(routes.admin.brands())
      revalidatePath(routes.admin.submissions())
      revalidatePath(routes.admin.jobs())
      revalidatePath(routes.admin.index())
      return result
    } catch (err) {
      console.error('[admin:requestCuratedProductBackfill]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}

function revalidateRejections(): void {
  revalidatePath(routes.admin.submissions())
  // getAdminNavCounts() drives the nav badges, so the dashboard shell has to be
  // revalidated alongside the queue page itself.
  revalidatePath(routes.admin.index())
}

export async function rejectSubmissionAction(
  submissionId: string,
  denialReason: DenialReason,
  notes: string
): Promise<{ error: string } | undefined> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      if (!DENIAL_REASONS.includes(denialReason)) {
        return { error: 'Invalid denial reason' }
      }

      if (denialReason === 'other' && notes.trim().length === 0) {
        return { error: 'Notes are required when using "Other" reason' }
      }

      await rejectSubmissionWorkflow(
        submissionId,
        auth.user.id,
        denialReason,
        notes,
        { notify: 'send' }
      )

      revalidateRejections()
      return undefined
    } catch (err) {
      console.error('[admin:rejectSubmission]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}

/**
 * One bulk Server Action per intent (docs/patterns/bulk-server-action-dispatch.md).
 * Next.js 16 serializes Server Actions dispatched from one client, so the
 * previous `Promise.all` over the per-item action was a client-to-server
 * waterfall that got slower in proportion to the selection.
 *
 * Concurrency: rejection has NO shared write set. `reject_submission` locks the
 * one `brand_submissions` row it rejects, deletes only that submission's own
 * `submission_images`, and never touches `brands`. Two rejections of two
 * submissions for the same brand therefore cannot contend — unlike
 * `reviewCorrections`, which has to group per `brand_id` because it writes
 * through to `brands`. Flat concurrency is safe because these rows do not
 * share a write set.
 */
export async function rejectSubmissionsAction(
  submissionIds: string[],
  denialReason: DenialReason
): Promise<{ failures: RejectionFailure[] } | { error: string }> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth
      const validated = validateIdBatch(submissionIds, {
        max: MAX_BULK_REJECTIONS,
        maxIdLength: MAX_REJECTION_ID_LENGTH,
        errorMessage: INVALID_REJECTION_BATCH_ERROR,
      })
      if (!validated.ok) return { error: validated.error }
      const ids = validated.ids

      if (!DENIAL_REASONS.includes(denialReason)) {
        return { error: 'Invalid denial reason' }
      }

      // The bulk flow carries one reason for the whole selection and no notes,
      // so "Other" — which requires per-submission notes — is not offered.
      if (denialReason === 'other') {
        return { error: 'Notes are required when using "Other" reason' }
      }

      const outcomes = await Promise.all(
        ids.map(async (submissionId): Promise<RejectionOutcome> => {
          try {
            // The timeout bounds the COMMIT only. Wrapping the notification too
            // meant a slow email reported an already-committed rejection as a
            // failure; the admin then retried the id and `reject_submission`
            // raised P0002 `Submission not found`.
            const submission = await withApprovalTimeout(
              commitSubmissionRejection(
                submissionId,
                auth.user.id,
                denialReason,
                ''
              ),
              'Rejection is taking longer than expected — check back shortly'
            )
            // Past this point the row is committed, so notification problems are
            // logged inside the helper and never fail the item.
            await notifySubmissionRejected(submission, denialReason, '')
            return { ok: true, submissionId }
          } catch (err) {
            console.error('[admin:rejectSubmissions]', { submissionId, error: err })
            return {
              ok: false,
              submissionId,
              error:
                err instanceof Error ? err.message : 'An unexpected error occurred',
            }
          }
        })
      )

      if (outcomes.some((outcome) => outcome.ok)) {
        try {
          revalidateRejections()
        } catch (err) {
          console.error('[admin:rejectSubmissions] revalidate failed:', err)
        }
      }

      return {
        failures: outcomes.flatMap((outcome) =>
          outcome.ok
            ? []
            : [{ submissionId: outcome.submissionId, error: outcome.error }]
        ),
      }
    } catch (err) {
      console.error('[admin:rejectSubmissions]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}

/**
 * The `/discover` half of a brand-visibility change.
 *
 * `revalidatePublicBrands` covers the brand's own surfaces; it deliberately
 * does NOT cover `/discover/[slug]`, which renders the brand's curated products
 * as trail tiles. Hiding a brand drops those tiles and unhiding restores them,
 * so both directions leave a trail stale for up to its ISR hour without this.
 *
 * Never a reason to fail the action: the write either already happened or is
 * about to, so a failed lookup costs a stale tile, not correctness. Mirrors
 * `trailSlugsForRevalidation` in the curated-products actions.
 */
async function brandTrailSlugsForRevalidation(
  brandId: string
): Promise<string[]> {
  return getBrandTrailSlugs(brandId).catch(() => [])
}

export async function hideBrandAction(
  brandId: string
): Promise<{ error: string } | undefined> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      // Resolved BEFORE the write: the placements this reads are the ones the
      // write is about to take off every trail, and the read is deliberately
      // not allowed to fail the hide.
      const trailSlugs = await brandTrailSlugsForRevalidation(brandId)
      const brand = await updateBrand(brandId, { status: 'hidden' })

      revalidatePath(routes.admin.brands())
      revalidatePath(routes.admin.index())
      revalidatePublicBrands([brand.slug])
      for (const trailSlug of trailSlugs) revalidateTrail(trailSlug)
      return undefined
    } catch (err) {
      console.error('[admin:hideBrand]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}

export async function unhideBrandAction(
  brandId: string
): Promise<{ error: string } | undefined> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      // Read before the write here too. Unhiding restores the brand's tiles to
      // the same trails, which is the identical staleness in the other
      // direction, and the placement rows are unchanged by the status write.
      const trailSlugs = await brandTrailSlugsForRevalidation(brandId)
      const brand = await updateBrand(brandId, {
        status: 'approved',
        hiddenReason: null,
      })

      revalidatePath(routes.admin.brands())
      revalidatePath(routes.admin.index())
      revalidatePublicBrands([brand.slug])
      for (const trailSlug of trailSlugs) revalidateTrail(trailSlug)
      return undefined
    } catch (err) {
      console.error('[admin:unhideBrand]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}

export async function deleteBrandAction(
  brandId: string
): Promise<{ error: string } | undefined> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      const brand = await getBrandById(brandId)
      await deleteBrand(brandId)

      revalidatePath(routes.admin.brands())
      revalidatePath(routes.admin.index())
      revalidatePublicBrands([brand.slug])
      return undefined
    } catch (err) {
      console.error('[admin:deleteBrand]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}

/**
 * Approve or reject one community stockist submission.
 *
 * A pending row is invisible on every public surface, so this is the only thing
 * that publishes one — and rejecting it is what keeps a wrong shop out of the
 * directory for good. Both the brand page and the city stockist pages are
 * revalidated because an approved row appears on both.
 *
 * Audited for exactly that reason: publishing a stranger's claim about a shop
 * onto a live brand page is an editorial decision on the same footing as
 * promoting a curated product, and `brand_channels` records only
 * `owner_status_by`, never which way the decision went or when a rejection
 * happened. `logAdminAction` is fire-and-forget, so it cannot fail the review.
 */
export async function reviewStockistAction(
  stockistId: string,
  decision: 'confirmed' | 'rejected',
): Promise<{ error: string } | undefined> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth
      if (!isAdminEntityId(stockistId)) return { error: 'Invalid stockist ID' }

      const result = await reviewCommunityStockist(
        stockistId,
        decision,
        auth.user.id,
      )
      if (!result.ok) return { error: result.code }

      if (auth.user.email) {
        await logAdminAction({
          adminUserId: auth.user.id,
          adminEmail: auth.user.email,
          action:
            decision === 'confirmed' ? 'stockist_approved' : 'stockist_rejected',
          targetBrandSlug: result.brandSlug,
          targetBrandId: result.brandId,
          metadata: { stockistId },
        })
      }

      revalidatePath(routes.admin.stockists())
      revalidatePath(routes.admin.index())
      revalidatePublicBrands([result.brandSlug])
      revalidatePublicStockists()
      return undefined
    } catch (error) {
      console.error('[admin:reviewStockist]', error)
      return {
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      }
    }
  });
}

export async function reviewReportAction(
  reportId: string,
  decision: 'reviewed' | 'dismissed',
  notes?: string,
): Promise<{ error: string } | undefined> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      if (decision !== 'reviewed' && decision !== 'dismissed') {
        return { error: 'Invalid report decision' }
      }

      const result = await updateReportStatus(reportId, decision, {
        reviewerId: auth.user.id,
        ...(notes !== undefined ? { notes } : {}),
      })
      if (!result.ok) return { error: result.code }

      revalidatePath(routes.admin.reports())
      revalidatePath(routes.admin.index())
      return undefined
    } catch (err) {
      console.error('[admin:reviewReport]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}

export async function reviewModerationFlagAction(
  flagId: string,
  decision: 'reviewed' | 'dismissed',
): Promise<{ error: string } | undefined> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      if (!isAdminEntityId(flagId)) {
        return { error: 'Invalid moderation flag ID' }
      }
      if (decision !== 'reviewed' && decision !== 'dismissed') {
        return { error: 'Invalid moderation decision' }
      }

      const result = await updateModerationFlagStatus(flagId, decision, {
        reviewerId: auth.user.id,
      })
      // A stable code, never a raw thrown message: the moderation UI renders
      // this string verbatim, so an internal diagnostic here reaches the admin
      // untranslated. Matches `reviewReportAction` returning `result.code`.
      if (!result.ok) return { error: result.code }

      revalidatePath(routes.admin.moderation())
      revalidatePath(routes.admin.index())
      return undefined
    } catch (err) {
      console.error('[admin:reviewModerationFlag]', err)
      return { error: 'database_error' }
    }
  });
}
