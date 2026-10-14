import {
  getSubmission,
  approveSubmission,
  applyBrandRefresh,
  rejectSubmission,
  isGeneratedGuestSubmissionEmail,
  type ApproveSubmissionResult,
  type SubmissionProductReview,
} from "@/lib/services/submissions";
import {
  getBrandById,
  syncBrandImages,
  updateBrand,
} from "@/lib/services/brands";
import { getBrandTrailSlugs } from "@/lib/services/curated-products";
import { materializeSubmissionCuratedProducts } from "@/lib/services/curated-products/materialize";
import { markFlagsReviewed } from "@/lib/services/moderation";
import { sendEmail } from "@/lib/email/send";
import type { EmailSendResult } from "@/lib/email/types";
import { buildApprovalEmail, buildRejectionEmail } from "@/lib/email/templates";
import { getSiteUrl } from "@/lib/site-url";
import { buildBrandListingPublishedEvent } from "@/lib/analytics/server-supply-events";
import type { BrandSubmission, DenialReason } from "@/lib/types";

/**
 * The admin review workflow — approve and reject — as ONE application service.
 *
 * Both the admin Server Actions (`src/app/admin/actions.ts`) and the operator
 * script (`scripts/enrichment/ops/approve-ready-submissions.ts`) call this.
 * The script used to copy the action "step for step" and drifted: it never
 * materialized curated products, never revalidated trails, never emitted
 * `brand_listing_published`, and unhid refreshed brands without clearing
 * `hiddenReason` (DEV-2030).
 *
 * Next-only side effects stay with the caller. Cache revalidation comes back as
 * data (`trailSlugs`, `brandSlug`), telemetry goes through `captureEvent`, and
 * whether a submitter is emailed is the caller's `notify` decision.
 *
 * Every collaborator is injectable through `steps` so the step order and the
 * "never fail an approval that committed" placement are testable without a
 * Supabase client; production callers use the defaults.
 */

const DEFAULT_STEPS = {
  getSubmission,
  approveSubmission: (submissionId: string, reviewerId: string) =>
    approveSubmission(submissionId, reviewerId),
  applyBrandRefresh,
  rejectSubmission,
  getBrandById,
  updateBrand,
  markFlagsReviewed,
  materializeSubmissionCuratedProducts,
  syncBrandImages,
  getBrandTrailSlugs,
  sendEmail,
  buildApprovalEmail,
  buildRejectionEmail,
  getSiteUrl,
};

type ReviewWorkflowSteps = {
  getSubmission: (submissionId: string) => Promise<BrandSubmission>;
  approveSubmission: (
    submissionId: string,
    reviewerId: string,
  ) => Promise<ApproveSubmissionResult>;
  applyBrandRefresh: typeof applyBrandRefresh;
  rejectSubmission: typeof rejectSubmission;
  getBrandById: typeof getBrandById;
  updateBrand: typeof updateBrand;
  markFlagsReviewed: typeof markFlagsReviewed;
  materializeSubmissionCuratedProducts: typeof materializeSubmissionCuratedProducts;
  syncBrandImages: typeof syncBrandImages;
  getBrandTrailSlugs: (brandId: string) => Promise<string[]>;
  sendEmail: typeof sendEmail;
  buildApprovalEmail: typeof buildApprovalEmail;
  buildRejectionEmail: typeof buildRejectionEmail;
  getSiteUrl: typeof getSiteUrl;
};

function resolveSteps(
  overrides: Partial<ReviewWorkflowSteps> = {},
): ReviewWorkflowSteps {
  return { ...DEFAULT_STEPS, ...overrides };
}

/** Whether the submitter is emailed. The operator scripts never email anyone. */
type NotifyMode = "send" | "skip";

type BrandListingPublishedEvent = NonNullable<
  ReturnType<typeof buildBrandListingPublishedEvent>
>;

type ApprovalDeps = {
  notify: NotifyMode;
  /** Emits `brand_listing_published`. Must not throw; a throw is logged anyway. */
  captureEvent: (event: BrandListingPublishedEvent) => void | Promise<void>;
  steps?: Partial<ReviewWorkflowSteps>;
};

type RejectionDeps = {
  notify: NotifyMode;
  steps?: Partial<ReviewWorkflowSteps>;
};

export type ApprovalResult = {
  brandSlug: string;
  refresh: boolean;
  /**
   * Trails whose tiles this approval changed. Revalidating them is the
   * caller's job — `revalidateTrail` inside a request, the Next-free
   * revalidation client from a script.
   */
  trailSlugs: string[];
  imageSyncWarning?: { synced: number; failed: number };
  storageCleanupWarning?: true;
};

// The rejection row is already committed by the time the notification runs, so
// this bounds a hung email provider instead of the decision itself.
const REJECTION_EMAIL_TIMEOUT_MS = 10_000;

/**
 * Curated-product proposals become rows only once the brand exists, so this
 * runs AFTER the approval RPC on both paths (DEV-1469). It works from the
 * effective review layer — a reviewer's edits and their tick set — which the
 * new-brand path already computed and hands over, and the refresh path leaves
 * the service to read.
 *
 * Never at the cost of an approval that already succeeded: the RPC has
 * committed by the time this runs, so a failure is reported and swallowed,
 * exactly like the stockist materialization in `approveSubmission`.
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
  steps: ReviewWorkflowSteps,
  submissionId: string,
  brandId: string,
  review?: SubmissionProductReview,
): Promise<void> {
  try {
    await steps.materializeSubmissionCuratedProducts(submissionId, brandId, {
      ...(review ? { review } : {}),
    });
  } catch (err) {
    console.error("[admin] materializeSubmissionCuratedProducts failed:", {
      submissionId,
      brandId,
      error: err,
    });
  }
}

export async function approveSubmissionWorkflow(
  submissionId: string,
  reviewerId: string,
  deps: ApprovalDeps,
): Promise<ApprovalResult> {
  const steps = resolveSteps(deps.steps);
  const submission = await steps.getSubmission(submissionId);
  if (submission.intent === "refresh") {
    const refresh = await steps.applyBrandRefresh(submissionId, reviewerId);
    const brand = await steps.getBrandById(refresh.brandId);
    // Approving is what brings a brand to life: a hidden brand whose refresh we
    // just accepted has publishable data by definition. Hiding stays a separate
    // admin action, so this never fights a deliberate re-hide.
    if (brand.status === "hidden") {
      await steps.updateBrand(refresh.brandId, {
        status: "approved",
        hiddenReason: null,
      });
    }
    await materializeProposedProducts(steps, submissionId, refresh.brandId);
    // The third hidden -> approved path, and the exact inverse of
    // `unhideBrandAction`: approving a refresh restores this brand's products to
    // every trail they are selected into, and `revalidatePublicBrands`
    // deliberately does not cover `/discover/[slug]` (`public-brand-cache.ts`).
    // Without revalidating these trails the trail keeps omitting the restored
    // tiles for up to its ISR hour, so they are returned for the caller to
    // revalidate.
    //
    // Read AFTER `materializeProposedProducts`: the placements that call just
    // wrote are part of what changed, and a read before it would miss them.
    // Never a reason to fail the approval — a failed read costs a stale tile.
    const trailSlugs = await steps
      .getBrandTrailSlugs(refresh.brandId)
      .catch((): string[] => []);
    return {
      brandSlug: brand.slug,
      refresh: true,
      trailSlugs,
      ...(refresh.cleanupFailed ? { storageCleanupWarning: true as const } : {}),
    };
  }

  const siteUrl = steps.getSiteUrl();

  const { brandId, submitterEmail, brandName, isBrandOwner, productReview } =
    await steps.approveSubmission(submissionId, reviewerId);
  const brand = await steps.getBrandById(brandId);
  let imageSyncWarning: { synced: number; failed: number } | undefined;

  try {
    await steps.markFlagsReviewed(brandId);
  } catch (err) {
    console.error("[admin] markFlagsReviewed failed:", err);
  }

  await materializeProposedProducts(steps, submissionId, brandId, productReview);

  if (brand.heroImageUrl) {
    try {
      const syncResult = await steps.syncBrandImages(brandId);
      if (syncResult.failed > 0) imageSyncWarning = syncResult;
    } catch (err) {
      console.error("[admin] syncBrandImages failed:", err);
      imageSyncWarning = { synced: 0, failed: 1 };
    }
  }

  if (
    deps.notify === "send" &&
    !isGeneratedGuestSubmissionEmail(submitterEmail)
  ) {
    await steps.sendEmail(
      await steps.buildApprovalEmail({
        submitterEmail,
        brandName,
        brandSlug: brand.slug,
        siteUrl,
      }),
    );
  }

  // Inventory telemetry is attributed to one machine identity, never to the
  // submitter. Instrumenting the shared workflow covers single and bulk
  // approvals, and the operator script.
  const listingPublishedEvent = buildBrandListingPublishedEvent(brand.name, {
    brand_id: brandId,
    brand_slug: brand.slug,
    is_brand_owner: isBrandOwner,
  });
  if (listingPublishedEvent) {
    try {
      await deps.captureEvent(listingPublishedEvent);
    } catch (err) {
      console.error("[admin] brand_listing_published capture failed:", err);
    }
  }

  return {
    brandSlug: brand.slug,
    refresh: false,
    // A new brand has no trail placements yet: materialization creates
    // products, never trail selections.
    trailSlugs: [],
    ...(imageSyncWarning ? { imageSyncWarning } : {}),
  };
}

/**
 * The committing half of a rejection: read the submission, then write the
 * decision. Split from the notification on purpose — this is the only part
 * whose failure means "the rejection did not happen", so it is the only part
 * a timeout may report as a failed item.
 */
export async function commitSubmissionRejection(
  submissionId: string,
  reviewerId: string,
  denialReason: DenialReason,
  notes: string,
  stepOverrides?: Partial<ReviewWorkflowSteps>,
): Promise<BrandSubmission> {
  const steps = resolveSteps(stepOverrides);
  const submission = await steps.getSubmission(submissionId);
  await steps.rejectSubmission(submissionId, reviewerId, denialReason, notes);
  return submission;
}

/**
 * The notification half. `sendEmail` NEVER throws — it catches internally and
 * returns `{ success: false, error }` — so a discarded return value silently
 * drops the submitter's notification while the caller reports success. Mirrors
 * the explicit result check used by other notification flows.
 *
 * Never throws and never reports a failure upward: the row is already
 * committed, and turning an undelivered email into a "rejection failed" row
 * makes the admin retry an id that `reject_submission` will then reject with
 * P0002 `Submission not found`.
 */
export async function notifySubmissionRejected(
  submission: BrandSubmission,
  denialReason: DenialReason,
  notes: string,
  stepOverrides?: Partial<ReviewWorkflowSteps>,
): Promise<void> {
  if (
    submission.intent === "refresh" ||
    isGeneratedGuestSubmissionEmail(submission.submitterEmail)
  ) {
    return;
  }

  const steps = resolveSteps(stepOverrides);
  try {
    const send = async () =>
      steps.sendEmail(
        await steps.buildRejectionEmail({
          submitterEmail: submission.submitterEmail,
          brandName: submission.brandName,
          denialReason,
          reviewerNotes: notes,
        }),
      );
    // Bounded so a hung provider cannot hold the bulk response open once every
    // row is already committed. A dropped notification beats a stuck queue.
    const sendResult = await Promise.race([
      send(),
      new Promise<EmailSendResult>((resolve) =>
        setTimeout(
          () => resolve({ success: false, error: "rejection email timed out" }),
          REJECTION_EMAIL_TIMEOUT_MS,
        ).unref?.(),
      ),
    ]);
    if (!sendResult.success) {
      console.error("[admin:rejectSubmission] rejection email not sent:", {
        submissionId: submission.id,
        error: sendResult.error,
      });
    }
  } catch (err) {
    console.error("[admin:rejectSubmission] rejection email threw:", {
      submissionId: submission.id,
      error: err,
    });
  }
}

/**
 * The single item workflow behind the per-row rejection action and the
 * `reject-skipped-submissions` operator script, so the two cannot drift. The
 * bulk action calls the two halves itself because it times out only the
 * commit.
 */
export async function rejectSubmissionWorkflow(
  submissionId: string,
  reviewerId: string,
  denialReason: DenialReason,
  notes: string,
  deps: RejectionDeps,
): Promise<void> {
  const submission = await commitSubmissionRejection(
    submissionId,
    reviewerId,
    denialReason,
    notes,
    deps.steps,
  );
  if (deps.notify === "send") {
    await notifySubmissionRejected(submission, denialReason, notes, deps.steps);
  }
}
