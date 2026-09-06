import {
  selectVerdictTargets,
  type VerdictTarget,
} from "@/lib/services/channel-verdicts";

/**
 * Selection for `scripts/reject-skipped-submissions.ts`.
 *
 * The bucket ("pending submissions whose newest curation target was skipped
 * with a given verdict prefix") is the same shape the job finalizer uses for
 * its no-purchase-channel verdicts, so the query lives once in
 * `channel-verdicts.ts` and each caller supplies its own prefix. This script's
 * prefix is the detect phase's non-brand verdict, and it never requires the
 * channel evidence enum — detection's verdict is complete on its own.
 */

/** The detect phase's verdict prefix; anything else skipped is a different problem. */
export const NOT_A_BRAND_PREFIX =
  "Detection classified this entry as not a brand";

export type NotABrandCandidate = {
  id: string;
  brandName: string;
  intent: string;
  verdict: string;
};

export async function loadNotABrandCandidates(
  select: typeof selectVerdictTargets = selectVerdictTargets,
): Promise<NotABrandCandidate[]> {
  const targets = await select({
    errorPrefix: NOT_A_BRAND_PREFIX,
    requireConclusive: false,
  });

  return targets.map((target: VerdictTarget) => ({
    id: target.submissionId,
    brandName: target.brandName,
    intent: target.intent,
    verdict: target.error,
  }));
}
