/**
 * Pure helpers for identifying refresh submissions that were requested but
 * never successfully applied. No side effects at import — the Supabase
 * rejection update lives in refresh.ts.
 */

export interface AppliedEntry {
  slug: string;
  submissionId: string;
  ok: boolean;
  detail: string;
}

export interface UnappliedEntry {
  slug: string;
  submissionId: string;
  detail: string;
}

/**
 * The fragment of the `apply_brand_refresh` exception raised when the latest
 * enrichment run for the submission is not `succeeded`. Matched as a substring
 * because the client error message may carry a prefix.
 */
export const ENRICHMENT_RUN_GATE_FRAGMENT =
  "successful enrichment run before apply";

/** True when an apply failed at the enrichment-run gate, not for another reason. */
export function isEnrichmentRunGateFailure(detail: string): boolean {
  return detail.includes(ENRICHMENT_RUN_GATE_FRAGMENT);
}

/**
 * Submissions to leave pending instead of auto-rejecting: their target in this
 * job ended `skipped` AND their apply failed at the enrichment-run gate. A
 * skip there is a verdict or a no-op rerun, and admin review decides it
 * (DEV-1929). Every other failure — stale snapshot, brand not approved or
 * hidden, already processed, lock timeout — is rejected as before, so the next
 * run requests a fresh snapshot instead of retrying a frozen one forever.
 */
export function pendingExemptSubmissionIds(
  applied: readonly AppliedEntry[],
  skippedSubmissionIds: ReadonlySet<string>,
): Set<string> {
  return new Set(
    applied
      .filter(
        (entry) =>
          !entry.ok &&
          skippedSubmissionIds.has(entry.submissionId) &&
          isEnrichmentRunGateFailure(entry.detail),
      )
      .map((entry) => entry.submissionId),
  );
}

/**
 * Returns submissions that were requested but either failed to apply or were
 * never attempted. Failed applies carry their original `detail`; missing
 * applies get `"not applied"`. Failed applies in `exemptSubmissionIds` (see
 * `pendingExemptSubmissionIds`) are left out; a never-attempted submission has
 * no gate failure, so it is never exempt.
 */
export function unappliedSubmissions(
  requested: Map<string, string>,
  applied: AppliedEntry[],
  exemptSubmissionIds: ReadonlySet<string> = new Set(),
): UnappliedEntry[] {
  const succeededIds = new Set(
    applied.filter((a) => a.ok).map((a) => a.submissionId),
  );

  const result: UnappliedEntry[] = [];

  // Failed applies (ok: false) — keep the original detail
  for (const entry of applied) {
    if (!entry.ok && !exemptSubmissionIds.has(entry.submissionId)) {
      result.push({
        slug: entry.slug,
        submissionId: entry.submissionId,
        detail: entry.detail,
      });
    }
  }

  // Requested but never appeared in applied at all
  const appliedIds = new Set(applied.map((a) => a.submissionId));
  for (const [slug, submissionId] of requested) {
    if (!appliedIds.has(submissionId) && !succeededIds.has(submissionId)) {
      result.push({ slug, submissionId, detail: "not applied" });
    }
  }

  return result;
}

/**
 * Builds a reviewer_notes value for a rejected refresh submission.
 * Truncated to 500 chars to stay within any column-length guard.
 */
export function rejectionNote(jobId: string, detail: string): string {
  return `DEV-1689 ${jobId}: ${detail}`.slice(0, 500);
}
