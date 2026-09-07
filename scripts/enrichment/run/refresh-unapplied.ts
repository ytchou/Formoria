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
 * Returns submissions that were requested but either failed to apply or were
 * never attempted. Failed applies carry their original `detail`; missing
 * applies get `"not applied"`.
 */
export function unappliedSubmissions(
  requested: Map<string, string>,
  applied: AppliedEntry[],
): UnappliedEntry[] {
  const succeededIds = new Set(
    applied.filter((a) => a.ok).map((a) => a.submissionId),
  );

  const result: UnappliedEntry[] = [];

  // Failed applies (ok: false) — keep the original detail
  for (const entry of applied) {
    if (!entry.ok) {
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
