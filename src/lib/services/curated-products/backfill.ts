import type { EnrichPhaseName } from "@/lib/constants/enrich-phases";
import { enqueueAdminCurationJob } from "@/lib/services/curation-jobs";
import {
  dropNeedsDataSubmissions,
  requestBrandRefresh,
} from "@/lib/services/submissions";

/**
 * The backfill entry point for generated curated products (DEV-1469).
 *
 * Two steps, in this order, per brand: `request_brand_refresh` mints the refresh
 * submission the proposals will ride, then ONE curation job carries every
 * submission at the products phase scope.
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
 *
 * THE PRODUCTS PHASE IS NOT SELF-SUFFICIENT, and `runEnrich` expands nothing —
 * it takes `phases` verbatim, and every phase gates itself on
 * `phases.includes(...)`. `['products']` alone therefore ran the phase against
 * an empty pipeline: `runLinksPhase` returns `scrapedData: null` when `links` is
 * absent, so the products prompt carried no candidate-page list and the model
 * was asked to pick product pages while being shown none — and `isProductPageUrl`
 * only checks host equality plus a non-root path, so an invented URL passed
 * validation and stood as its own citation.
 *
 * The set below is the transitive closure of the products phase's real inputs,
 * read off the pipeline rather than guessed:
 *
 * - `links`         — produces `state.scrapedData` (the candidate pages and the
 *                     scraped image pages) AND the quarantine records
 *                     `site_identity` consumes. Hard dependency of both.
 * - `site_identity` — arbitrates the resolved `purchase_website`; its revocation
 *                     is applied to the pending patch that `runProductsPhase`
 *                     reads through, which is what stops a revoked site being
 *                     mined for products (`constants/enrich-phases.ts`).
 * - `products`      — the phase itself.
 *
 * Nothing else is a prerequisite, and each exclusion was checked:
 * `applyChunkNameCleanup` runs unconditionally, so `clean` is not needed for a
 * usable brand name; `links` scrapes `collectKnownUrls(brand)` — the brand's own
 * link columns, which an existing brand already has — so `discover` (a paid
 * serper call) is not needed to give it URLs; and the products phase loads its
 * image evidence from ALREADY-PERSISTED image rows, so `images` /
 * `classify_images` are not needed either.
 */
const CURATED_PRODUCT_BACKFILL_PHASES = [
  "links",
  "site_identity",
  "products",
] as const satisfies readonly EnrichPhaseName[];

type CuratedProductBackfillOutcome = {
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

/**
 * The three database calls this function composes, injectable so the failure
 * paths can be driven without a module mock — `check-test-boundaries.mjs`
 * forbids `vi.mock` of `@/lib/services/`, and the compensating path below is
 * reachable only when the enqueue throws.
 */
export type CuratedProductBackfillDeps = {
  requestRefresh: typeof requestBrandRefresh;
  enqueueJob: typeof enqueueAdminCurationJob;
  rollbackSubmissions: typeof dropNeedsDataSubmissions;
};

const PRODUCTION_DEPS: CuratedProductBackfillDeps = {
  requestRefresh: requestBrandRefresh,
  enqueueJob: enqueueAdminCurationJob,
  rollbackSubmissions: dropNeedsDataSubmissions,
};

export async function requestCuratedProductBackfill(
  brandIds: string[],
  requester: { id: string; email: string },
  deps: CuratedProductBackfillDeps = PRODUCTION_DEPS,
): Promise<CuratedProductBackfillResult> {
  const uniqueBrandIds = [...new Set(brandIds.filter(Boolean))];
  const outcomes: CuratedProductBackfillOutcome[] = [];

  // One at a time. The RPC locks the brand row, and a batch that raced itself
  // would turn a handled 23505 into an arbitrary winner.
  for (const brandId of uniqueBrandIds) {
    try {
      const { submissionId } = await deps.requestRefresh(brandId, requester);
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
  // group. The phase scope is the entire point of this job.
  try {
    const job = await deps.enqueueJob({
      params: {
        submissionIds,
        phases: [...CURATED_PRODUCT_BACKFILL_PHASES],
      },
      dryRun: false,
      startedBy: requester.email,
    });
    return { jobId: job.id, outcomes };
  } catch (error) {
    // COMPENSATE, because the order cannot be swapped: the job needs its
    // submissions to exist. `resolveTargets` and `enqueueCurationJob` both hit
    // the database, so this throw is reachable — and every submission opened
    // above is then a PENDING refresh with no job behind it. Left in place they
    // are stranded forever: the retry raises 23505 on every brand, nothing new
    // opens, `submissionIds` is empty, and the function reports "nothing to do"
    // while the brands can never be refreshed again.
    //
    // `drop_needs_data_submissions` is the sanctioned delete: it re-derives each
    // stage under a row lock and refuses anything past Needs Data, so it can
    // only remove submissions that are still exactly as this call left them, and
    // its own cap (100) is the cap this action already enforces.
    const message = describeRefreshError(error);
    let rolledBack = false;
    try {
      await deps.rollbackSubmissions(submissionIds);
      rolledBack = true;
    } catch (rollbackError) {
      console.error(
        "[curatedProductBackfill] rollback failed; refresh submissions are stranded:",
        { submissionIds, rollbackError },
      );
    }

    return {
      jobId: null,
      outcomes: outcomes.map((outcome) =>
        outcome.submissionId
          ? {
              brandId: outcome.brandId,
              // Truthful only once the rollback succeeded: while the submission
              // still exists, reporting `null` would hide the row that is now
              // blocking every future refresh of this brand.
              submissionId: rolledBack ? null : outcome.submissionId,
              error: rolledBack
                ? `Queueing the product run failed, so the refresh was rolled back — retry. (${message})`
                : `Queueing the product run failed and the refresh could NOT be rolled back; submission ${outcome.submissionId} is still pending. (${message})`,
            }
          : outcome,
      ),
    };
  }
}
