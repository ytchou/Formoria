'use server'

import { runWithAuditContext } from '@/lib/audit/context'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { requireAdminAction } from '@/lib/auth/require-admin'
import {
  getSubmission,
  getApprovedOwnerSubmissionRecipients,
  approveSubmission,
  applyBrandRefresh,
  rejectSubmission,
  reopenSubmission,
  requestBrandRefresh,
  isGeneratedGuestSubmissionEmail,
  type SubmissionProductReview,
} from '@/lib/services/submissions'
import { getOwnerLocale } from '@/lib/services/profiles'
import {
  approveClaimRequest,
  getClaimRequest,
  rejectClaimRequest,
} from '@/lib/services/claim-requests'
import { processClaimProofCleanup } from '@/lib/services/claim-proof-cleanup'
import { verifyMitByCert } from '@/lib/services/mit-verification'
import {
  deleteBrand,
  getBrandById,
  syncBrandImages,
  updateBrand,
} from '@/lib/services/brands'
import {
  getUserBrandByEmail,
  revokeOwnership,
} from '@/lib/services/brand-owners'
import { materializeSubmissionCuratedProducts } from '@/lib/services/curated-products/materialize'
import {
  requestCuratedProductBackfill,
  type CuratedProductBackfillResult,
} from '@/lib/services/curated-products/backfill'
import {
  scanContent,
  saveModerationFlags,
  markFlagsReviewed,
  updateModerationFlagStatus,
} from '@/lib/services/moderation'
import { sendEmail } from '@/lib/email/send'
import type { EmailSendResult } from '@/lib/email/types'
import { validateIdBatch } from '@/lib/validation/id-batch'
import { reviewEntityIdSchema } from '@/lib/validation/admin-review'
import { MAX_BULK_PRODUCT_BACKFILL } from '@/lib/constants/curated-products'
import { z } from 'zod'
import {
  buildApprovalEmail,
  buildRejectionEmail,
  buildClaimEmail,
  buildClaimApprovedEmail,
  buildClaimRejectedEmail,
  buildOwnershipRevokedEmail,
} from '@/lib/email/templates'
import { createEmailPreferences } from '@/lib/services/email-lifecycle'
import { generateClaimToken } from '@/lib/auth/claim-token'
import { updateReportStatus } from '@/lib/services/reports'
import {
  reviewCorrections,
  validateCorrectionBatch,
  type CorrectionBatchFailure,
  type CorrectionDecision,
} from '@/lib/services/brand-corrections'
import {
  reviewEvidenceBatch,
  validateEvidenceBatch,
  type EvidenceBatchFailure,
  type OriginEvidenceDecision,
} from '@/lib/services/origin-evidence'
import { reviewCommunityStockist } from '@/lib/services/stockists'
import { logAdminAction } from '@/lib/services/admin-audit'
import { FEATURE_FLAGS, setAppSetting } from '@/lib/services/app-settings'
import {
  DENIAL_REASONS,
  type BrandSubmission,
  type DenialReason,
  type OtherUrl,
} from '@/lib/types'
import { getSiteUrl } from '@/lib/site-url'
import { getPostHogClient } from '@/lib/posthog-server'
import { ANALYTICS_EVENTS } from '@/lib/analytics/events'
import { buildBrandListingPublishedEvent } from '@/lib/analytics/server-supply-events'
import {
  revalidatePublicBrands,
  revalidatePublicStockists,
} from '@/lib/cache/public-brand-cache'
import { routes } from '@/lib/routes'

// Analytics runs inside withApprovalTimeout and after the DB commit, so an unbounded
// flush could exhaust the approval budget and report failure for an approval that
// actually succeeded. Cap it well under APPROVAL_ITEM_TIMEOUT_MS; a dropped event is
// always preferable to a false approval failure.
const SUPPLY_EVENT_FLUSH_TIMEOUT_MS = 2_000

/**
 * Supply-side events are captured server-side because the admin/owner action that
 * produces them never reaches the browser analytics sink. Analytics must never fail
 * the underlying action, so every capture is swallowed and time-bounded.
 */
async function captureSupplyEvent(
  distinctId: string,
  event: string,
  properties: Record<string, string | boolean>,
): Promise<void> {
  try {
    const posthog = getPostHogClient()
    posthog.capture({ distinctId, event, properties })
    await Promise.race([
      posthog.flush(),
      new Promise((resolve) =>
        setTimeout(resolve, SUPPLY_EVENT_FLUSH_TIMEOUT_MS).unref?.()
      ),
    ])
  } catch (err) {
    console.error(`[analytics:${event}] capture failed`, err)
  }
}

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

type ApprovalResult = {
  brandSlug: string
  refresh: boolean
  imageSyncWarning?: { synced: number; failed: number }
  storageCleanupWarning?: true
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

// The rejection row is already committed by the time the notification runs, so
// this bounds a hung email provider instead of the decision itself.
const REJECTION_EMAIL_TIMEOUT_MS = 10_000

// Bulk approval processes every submission concurrently, and the whole
// action only responds once every item has settled. One submission that
// hangs on a slow DB round trip (e.g. a stale-refresh check contending with
// other writes) otherwise keeps the client from learning about the other,
// already-committed approvals in the same batch — bound each item so the
// response never waits on the single slowest one.
const APPROVAL_ITEM_TIMEOUT_MS = 20_000

function withApprovalTimeout<T>(
  promise: Promise<T>,
  message = 'Approval is taking longer than expected — check back shortly'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message))
    }, APPROVAL_ITEM_TIMEOUT_MS)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

export async function resendClaimInviteAction(
  brandId: string
): Promise<{ resent: true } | { error: string }> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      const brand = await getBrandById(brandId)
      if (brand.status !== 'approved') {
        return { error: 'Claim invitations can only be resent for approved brands' }
      }
      if (brand.isVerified) {
        return { error: 'This brand already has an owner' }
      }

      const recipients = await getApprovedOwnerSubmissionRecipients([brandId])
      const recipient = recipients.get(brandId)
      if (!recipient) {
        return { error: 'No approved owner submission was found for this brand' }
      }

      const siteUrl = getSiteUrl()
      const token = await generateClaimToken(brandId, recipient.submitterEmail, brand.name)
      const claimUrl = `${siteUrl}/auth/sign-up?claim=${token}`
      const delivery = await sendEmail(await buildClaimEmail({
        submitterEmail: recipient.submitterEmail,
        brandName: brand.name,
        claimUrl,
        siteUrl,
      }))
      if (!delivery.success) {
        throw new Error(delivery.error ?? 'Claim invitation could not be sent')
      }

      revalidatePath(routes.admin.brands())
      return { resent: true }
    } catch (err) {
      console.error('[admin:resendClaimInvite]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}
/**
 * Curated-product proposals become rows only once the brand exists, so this
 * runs AFTER the approval RPC on both paths (DEV-1469). It works from the
 * effective review layer — a reviewer's edits and their tick set — which the
 * new-brand path already computed and hands over, and the refresh path leaves
 * the service to read.
 *
 * Never at the cost of an approval that already succeeded: the RPC has
 * committed by the time this runs, so a failure is reported and swallowed,
 * exactly like the enriched-channels upsert in `approveSubmission`.
 *
 * WHAT THE RECOVERY ACTUALLY IS. Requesting another products refresh re-runs
 * the phase and re-materializes, and that re-run is a repair, not a no-op:
 * the materializer writes per proposal, so one failure costs one product, and a
 * product whose row landed while its `curated_product_sources` write did not is
 * re-attached to its evidence by the diff's repair branch rather than skipped
 * as a decision. Without that branch the half-created row was permanent — every
 * public read drops it on the `!inner` evidence join, and the re-run matched it
 * and moved on.
 */
async function materializeProposedProducts(
  submissionId: string,
  brandId: string,
  review?: SubmissionProductReview
): Promise<void> {
  try {
    await materializeSubmissionCuratedProducts(submissionId, brandId, {
      ...(review ? { review } : {}),
    })
  } catch (err) {
    console.error('[admin] materializeSubmissionCuratedProducts failed:', {
      submissionId,
      brandId,
      error: err,
    })
  }
}

async function approveSubmissionForAdmin(
  submissionId: string,
  reviewerId: string
): Promise<ApprovalResult> {
  const submission = await getSubmission(submissionId)
  if (submission.intent === 'refresh') {
    const refresh = await applyBrandRefresh(submissionId, reviewerId)
    const brand = await getBrandById(refresh.brandId)
    // Approving is what brings a brand to life: a hidden brand whose refresh we
    // just accepted has publishable data by definition. Hiding stays a separate
    // admin action, so this never fights a deliberate re-hide.
    if (brand.status === 'hidden') {
      await updateBrand(refresh.brandId, { status: 'approved' })
    }
    await materializeProposedProducts(submissionId, refresh.brandId)
    return {
      brandSlug: brand.slug,
      refresh: true,
      ...(refresh.cleanupFailed ? { storageCleanupWarning: true as const } : {}),
    }
  }

  const siteUrl = getSiteUrl()

  const { brandId, submitterEmail, brandName, isBrandOwner, productReview } = await approveSubmission(submissionId, reviewerId)
  const brand = await getBrandById(brandId)
  let imageSyncWarning: { synced: number; failed: number } | undefined

  try {
    await markFlagsReviewed(brandId)
  } catch (err) {
    console.error('[admin] markFlagsReviewed failed:', err)
  }

  await materializeProposedProducts(submissionId, brandId, productReview)

  if (brand.heroImageUrl) {
    try {
      const syncResult = await syncBrandImages(brandId)
      if (syncResult.failed > 0) imageSyncWarning = syncResult
    } catch (err) {
      console.error('[admin] syncBrandImages failed:', err)
      imageSyncWarning = { synced: 0, failed: 1 }
    }
  }

  const existingOwnedBrand = isBrandOwner
    ? await getUserBrandByEmail(submitterEmail)
    : null

  const shouldEmailSubmitter = !isGeneratedGuestSubmissionEmail(submitterEmail)

  if (isBrandOwner && !existingOwnedBrand) {
    const token = await generateClaimToken(brandId, submitterEmail, brandName)
    const claimUrl = `${siteUrl}/auth/sign-up?claim=${token}`
    await sendEmail(await buildClaimEmail({
      submitterEmail,
      brandName,
      claimUrl,
      siteUrl,
    }))
  } else if (shouldEmailSubmitter) {
    await sendEmail(await buildApprovalEmail({
      submitterEmail,
      brandName,
      brandSlug: brand.slug,
      siteUrl,
    }))
  }

  // Inventory telemetry is attributed to one machine identity, never to the
  // submitter. Instrumenting the shared helper covers single and bulk approvals.
  const listingPublishedEvent = buildBrandListingPublishedEvent(brand.name, {
    brand_id: brandId,
    brand_slug: brand.slug,
    is_brand_owner: isBrandOwner,
  })
  if (listingPublishedEvent) {
    await captureSupplyEvent(
      listingPublishedEvent.distinctId,
      listingPublishedEvent.event,
      listingPublishedEvent.properties,
    )
  }

  return {
    brandSlug: brand.slug,
    refresh: false,
    ...(imageSyncWarning ? { imageSyncWarning } : {}),
  }
}

function revalidateApprovals(results: ApprovalResult[]): void {
  revalidatePath(routes.admin.submissions())
  revalidatePath(routes.admin.index())
  if (results.some((result) => result.refresh)) {
    revalidatePath(routes.admin.brands())
  }
  revalidatePublicBrands(results.map((result) => result.brandSlug))
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
        approveSubmissionForAdmin(submissionId, auth.user.id)
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
                approveSubmissionForAdmin(submissionId, auth.user.id)
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

export async function reviewEvidenceBatchAction(
  evidenceIds: string[],
  decision: OriginEvidenceDecision,
  notes: string,
): Promise<{ failures: EvidenceBatchFailure[] } | { error: string }> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      const validated = validateEvidenceBatch(evidenceIds)
      if (!validated.ok) return { error: validated.error }

      if (decision !== 'approved' && decision !== 'rejected') {
        return { error: 'Invalid evidence decision' }
      }

      const result = await reviewEvidenceBatch(
        validated.ids,
        decision,
        notes,
        { reviewerId: auth.user.id }
      )
      if ('error' in result) return result

      revalidatePath(routes.admin.evidence())
      revalidatePath(routes.admin.index())
      return result
    } catch (err) {
      console.error('[admin:reviewEvidenceBatch]', err)
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

/**
 * The committing half of a rejection: read the submission, then write the
 * decision. Split from the notification on purpose — this is the only part
 * whose failure means "the rejection did not happen", so it is the only part
 * a timeout may report as a failed item.
 */
async function commitSubmissionRejection(
  submissionId: string,
  reviewerId: string,
  denialReason: DenialReason,
  notes: string
): Promise<BrandSubmission> {
  const submission = await getSubmission(submissionId)
  await rejectSubmission(submissionId, reviewerId, denialReason, notes)
  return submission
}

/**
 * The notification half. `sendEmail` NEVER throws — it catches internally and
 * returns `{ success: false, error }` — so a discarded return value silently
 * drops the submitter's notification while the caller reports success. Mirrors
 * the explicit result check in `@/lib/services/origin-evidence`.
 *
 * Never throws and never reports a failure upward: the row is already
 * committed, and turning an undelivered email into a "rejection failed" row
 * makes the admin retry an id that `reject_submission` will then reject with
 * P0002 `Submission not found`.
 */
async function notifySubmissionRejected(
  submission: BrandSubmission,
  denialReason: DenialReason,
  notes: string
): Promise<void> {
  if (
    submission.intent === 'refresh' ||
    isGeneratedGuestSubmissionEmail(submission.submitterEmail)
  ) {
    return
  }

  try {
    const send = async () =>
      sendEmail(await buildRejectionEmail({
        submitterEmail: submission.submitterEmail,
        brandName: submission.brandName,
        denialReason,
        reviewerNotes: notes,
      }))
    // Bounded so a hung provider cannot hold the bulk response open once every
    // row is already committed. A dropped notification beats a stuck queue.
    const sendResult = await Promise.race([
      send(),
      new Promise<EmailSendResult>((resolve) =>
        setTimeout(
          () => resolve({ success: false, error: 'rejection email timed out' }),
          REJECTION_EMAIL_TIMEOUT_MS
        ).unref?.()
      ),
    ])
    if (!sendResult.success) {
      console.error('[admin:rejectSubmission] rejection email not sent:', {
        submissionId: submission.id,
        error: sendResult.error,
      })
    }
  } catch (err) {
    console.error('[admin:rejectSubmission] rejection email threw:', {
      submissionId: submission.id,
      error: err,
    })
  }
}

/**
 * The single item workflow behind both the per-row and the bulk rejection
 * action, so single and bulk behavior cannot drift.
 * `scripts/reject-skipped-submissions.ts` mirrors this by comment, not by
 * import — it deliberately omits the notification email.
 */
async function rejectSubmissionForAdmin(
  submissionId: string,
  reviewerId: string,
  denialReason: DenialReason,
  notes: string
): Promise<void> {
  const submission = await commitSubmissionRejection(
    submissionId,
    reviewerId,
    denialReason,
    notes
  )
  await notifySubmissionRejected(submission, denialReason, notes)
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

      await rejectSubmissionForAdmin(
        submissionId,
        auth.user.id,
        denialReason,
        notes
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
 * through to `brands`. Flat concurrency is safe here for the same reason it is
 * in `reviewEvidenceBatch`.
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

export async function reopenSubmissionAction(
  submissionId: string
): Promise<{ error: string } | undefined> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      await reopenSubmission(submissionId)

      revalidatePath(routes.admin.submissions())
      revalidatePath(routes.admin.index())
      return undefined
    } catch (err) {
      console.error('[admin:reopenSubmission]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}

const CLAIM_PROOF_CLEANUP_WARNING = 'Proof deletion remains queued for automatic retry.'

type ClaimDecisionActionResult =
  | { error?: string; warning?: string }
  | undefined

async function processImmediateClaimProofCleanup(
  claimRequestId: string
): Promise<string | undefined> {
  try {
    const summary = await processClaimProofCleanup({ claimRequestId })
    return summary.failed > 0 ? CLAIM_PROOF_CLEANUP_WARNING : undefined
  } catch (err) {
    console.error('[admin:claim-proof-cleanup] process failed', err)
    return CLAIM_PROOF_CLEANUP_WARNING
  }
}

export async function approveClaimAction(
  claimRequestId: string
): Promise<ClaimDecisionActionResult> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      const claimRequest = await getClaimRequest(claimRequestId)
      const siteUrl = getSiteUrl()
      await approveClaimRequest(claimRequestId, auth.user.id)
      const cleanupWarning = await processImmediateClaimProofCleanup(claimRequestId)

      try {
        const serviceSupabase = createServiceClient()
        await createEmailPreferences(serviceSupabase, claimRequest.userId)
      } catch (err) {
        console.error('[claim-approved-email-preferences] create failed', err)
      }

      if (claimRequest.mitSmileCert) {
        try {
          const mitResult = await verifyMitByCert(claimRequest.brandId, claimRequest.mitSmileCert)
          if (mitResult.error) {
            console.warn('[admin:approveClaimAction] MIT auto-verify skipped:', mitResult.error)
          }
        } catch (err) {
          console.warn('[admin:approveClaimAction] MIT auto-verify error:', err)
        }
      }

      revalidatePath(routes.admin.claims())
      revalidatePath(routes.admin.index())

      if (claimRequest.brandSlug) {
        revalidatePublicBrands([claimRequest.brandSlug])
      }

      try {
        if (claimRequest.requesterEmail && claimRequest.brandName && claimRequest.brandSlug) {
          const locale = await getOwnerLocale(claimRequest.brandId)
          await sendEmail(await buildClaimApprovedEmail({
            ownerEmail: claimRequest.requesterEmail,
            brandName: claimRequest.brandName,
            brandSlug: claimRequest.brandSlug,
            siteUrl,
            locale,
          }))
        }
      } catch (err) {
        console.error('[claim-approved-email] send failed', err)
      }

      // Attributed to the claiming owner, not the approving admin.
      const claimantDistinctId = claimRequest.userId || claimRequest.requesterEmail
      if (claimantDistinctId) {
        await captureSupplyEvent(claimantDistinctId, ANALYTICS_EVENTS.BRAND_CLAIM_APPROVED, {
          brand_id: claimRequest.brandId,
          ...(claimRequest.brandSlug ? { brand_slug: claimRequest.brandSlug } : {}),
          claim_request_id: claimRequestId,
        })
      }

      return cleanupWarning ? { warning: cleanupWarning } : undefined
    } catch (err) {
      console.error('[admin:approveClaimAction]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}

export async function rejectClaimAction(
  claimRequestId: string,
  notes: string
): Promise<ClaimDecisionActionResult> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      const claimRequest = await getClaimRequest(claimRequestId)
      const siteUrl = getSiteUrl()
      await rejectClaimRequest(claimRequestId, auth.user.id, notes)
      const cleanupWarning = await processImmediateClaimProofCleanup(claimRequestId)

      revalidatePath(routes.admin.claims())
      revalidatePath(routes.admin.index())

      try {
        if (claimRequest.requesterEmail && claimRequest.brandName) {
          await sendEmail(await buildClaimRejectedEmail({
            ownerEmail: claimRequest.requesterEmail,
            brandName: claimRequest.brandName,
            reviewerNotes: notes,
            siteUrl,
          }))
        }
      } catch (err) {
        console.error('[claim-rejected-email] send failed', err)
      }

      return cleanupWarning ? { warning: cleanupWarning } : undefined
    } catch (err) {
      console.error('[admin:rejectClaimAction]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}

export async function updateBrandAction(
  brandId: string,
  data: {
    name?: string
    description?: string
    category?: string
    status?: string
    website?: string
    purchaseUrl?: string
    categorySlug?: string
    socialInstagram?: string | null
    socialThreads?: string | null
    socialFacebook?: string | null
    purchaseWebsite?: string | null
    purchasePinkoi?: string | null
    purchaseShopee?: string | null
    purchaseMyship?: string | null
    otherUrls?: OtherUrl[]
  }
): Promise<{ error: string } | undefined> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      const {
        name,
        description,
        website,
        purchaseUrl,
        socialInstagram,
        socialThreads,
        socialFacebook,
        purchaseWebsite,
        purchasePinkoi,
        purchaseShopee,
        purchaseMyship,
      } = data
      const moderationFields = {
        name,
        description,
        website,
        purchaseUrl,
        socialInstagram: socialInstagram ?? undefined,
        socialThreads: socialThreads ?? undefined,
        socialFacebook: socialFacebook ?? undefined,
        purchaseWebsite: purchaseWebsite ?? undefined,
        purchasePinkoi: purchasePinkoi ?? undefined,
        purchaseShopee: purchaseShopee ?? undefined,
        purchaseMyship: purchaseMyship ?? undefined,
      }
      const { violations } = scanContent(name ?? '', moderationFields)
      if (violations.length > 0) {
        try {
          await saveModerationFlags(brandId, auth.user.id, violations, 'pending')
        } catch (err) {
          console.error('[admin] moderation audit failed:', err)
        }

        return { error: violations.map((violation) => violation.userMessage).join('. ') }
      }

      const previousBrand = await getBrandById(brandId)
      const updatedBrand = await updateBrand(
        brandId,
        data as Parameters<typeof updateBrand>[1],
      )

      revalidatePath(routes.admin.brands())
      revalidatePath(routes.admin.index())
      revalidatePublicBrands([updatedBrand.slug, previousBrand.slug])
      return undefined
    } catch (err) {
      console.error('[admin:updateBrand]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}

export async function hideBrandAction(
  brandId: string
): Promise<{ error: string } | undefined> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      const brand = await updateBrand(brandId, { status: 'hidden' })

      revalidatePath(routes.admin.brands())
      revalidatePath(routes.admin.index())
      revalidatePublicBrands([brand.slug])
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

      const brand = await updateBrand(brandId, { status: 'approved' })

      revalidatePath(routes.admin.brands())
      revalidatePath(routes.admin.index())
      revalidatePublicBrands([brand.slug])
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
      revalidatePublicStockists(result.city)
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

export async function revokeOwnershipAction(
  brandId: string,
  reason: string
): Promise<{ error: string } | undefined> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      const trimmedReason = reason.trim()
      if (!trimmedReason) return { error: 'Reason is required' }
      if (!auth.user.email) return { error: 'Admin email is required' }

      const result = await revokeOwnership(brandId, auth.user.email, trimmedReason)
      const brand = await getBrandById(brandId)

      await sendEmail(await buildOwnershipRevokedEmail({
        ownerEmail: result.email,
        brandName: brand.name,
        reason: trimmedReason,
      }))

      revalidatePath(routes.admin.reports())
      revalidatePath(routes.admin.index())
      revalidatePublicBrands([brand.slug])
      return undefined
    } catch (err) {
      console.error('[admin:revokeOwnership]', err)
      if (
        typeof err === 'object'
        && err !== null
        && 'message' in err
        && err.message === 'Brand owner not found'
      ) {
        return { error: 'Brand owner not found' }
      }
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}

export async function setFeatureFlagAction(
  key: string,
  enabled: boolean
): Promise<{
  error?: string
  code?: 'unauthenticated' | 'forbidden'
}> {
  return runWithAuditContext({}, async () => {
    try {
      const auth = await requireAdminAction()
      if ('error' in auth) return auth

      const flag = FEATURE_FLAGS.find((entry) => entry.key === key)
      if (!flag) {
        return { error: 'Unknown feature flag' }
      }

      await setAppSetting(key, enabled)
      flag.revalidatePaths.forEach((path) => revalidatePath(path))
      return {}
    } catch (err) {
      console.error('[admin:setFeatureFlag]', err)
      return {
        error: err instanceof Error ? err.message : 'An unexpected error occurred',
      }
    }
  });
}
