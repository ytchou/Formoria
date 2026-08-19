import { enqueueAdminCurationJob } from "@/lib/services/curation-jobs";
import { requestBrandRefresh } from "@/lib/services/submissions";

/**
 * The backfill entry point for generated curated products (DEV-1469).
 *
 * Two steps, in this order, per brand: `request_brand_refresh` mints the refresh
 * submission the proposals will ride, then ONE curation job carries every
 * submission at the `products` phase only.
 *
 * WHY NO NEW TARGET TYPE. `request_brand_refresh(p_brand_id, p_requested_by,
 * p_requester_email)` takes no phase argument — phase scope is a property of the
 * JOB, not of the target — so the targets stay ordinary submission targets and
 * every existing runner, resume, and rerun path keeps working unchanged.
 *
 * SEQUENTIAL PER BRAND, BY THE DATABASE. The RPC takes a row lock on the brand
 * and raises 23505 ('A refresh is already pending for this brand') when one is
 * already open, so a brand that is mid-refresh is reported and skipped instead
 * of queued twice. That message is already admin-readable, so it is passed
 * through verbatim rather than mapped.
 *
 * Selection is a rollout mechanism, not a permanent scope limit: nothing here
 * caps the brand count, so the same call serves 5 brands today and the whole
 * directory later.
 */
/**
 * Not exported: a test that imported this could not catch a wrong value, so the
 * phase scope is asserted as a literal at the boundary instead.
 */
const CURATED_PRODUCT_BACKFILL_PHASES = ["products"] as const;

export type CuratedProductBackfillOutcome = {
  brandId: string;
  /** The refresh submission the proposals will ride, or null when none opened. */
  submissionId: string | null;
  /** An admin-readable reason, never a stack: 23505 lands here, not in a throw. */
  error: string | null;
};

export type CuratedProductBackfillResult = {
  /** Null when no brand opened a refresh, so there was nothing to enqueue. */
  jobId: string | null;
  outcomes: CuratedProductBackfillOutcome[];
};

/**
 * Supabase rejects an RPC with a plain `{ message, code }` object, not an Error,
 * so `err instanceof Error` alone collapses every real cause into "unexpected".
 * `describeApprovalError` in `app/admin/actions.ts` solves the same problem, and
 * cannot be imported: that file is `'use server'`, where every export is a
 * callable server action.
 */
function describeRefreshError(error: unknown): string {
  const candidate = error as { message?: string } | null;
  if (error instanceof Error && error.message) return error.message;
  if (typeof candidate?.message === "string" && candidate.message) {
    return candidate.message;
  }
  return "The refresh request failed";
}

export async function requestCuratedProductBackfill(
  brandIds: string[],
  requester: { id: string; email: string },
): Promise<CuratedProductBackfillResult> {
  const uniqueBrandIds = [...new Set(brandIds.filter(Boolean))];
  const outcomes: CuratedProductBackfillOutcome[] = [];

  // One at a time. The RPC locks the brand row, and a batch that raced itself
  // would turn a handled 23505 into an arbitrary winner.
  for (const brandId of uniqueBrandIds) {
    try {
      const { submissionId } = await requestBrandRefresh(brandId, requester);
      outcomes.push({ brandId, submissionId, error: null });
    } catch (error) {
      outcomes.push({
        brandId,
        submissionId: null,
        error: describeRefreshError(error),
      });
    }
  }

  const submissionIds = outcomes.flatMap((outcome) =>
    outcome.submissionId ? [outcome.submissionId] : [],
  );
  if (submissionIds.length === 0) return { jobId: null, outcomes };

  // `phases`, not `steps`: `runEnrich` resolves `steps` FIRST and lets it beat
  // `phases`, so a job that carried both would silently widen to the whole step
  // group. One phase is the entire point of this job.
  const job = await enqueueAdminCurationJob({
    params: {
      submissionIds,
      phases: [...CURATED_PRODUCT_BACKFILL_PHASES],
    },
    dryRun: false,
    startedBy: requester.email,
  });

  return { jobId: job.id, outcomes };
}
