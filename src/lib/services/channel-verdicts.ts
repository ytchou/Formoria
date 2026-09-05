import type { SupabaseClient } from "@supabase/supabase-js";

import { requestPublicBrandRevalidation } from "@/lib/cache/revalidate-client";
import { CURATION_AGENT_REVIEWER_ID } from "@/lib/constants/curation";
import { hideBrandWithReason } from "@/lib/services/brands";
import { EVIDENCE_SOURCE_KEYS } from "@/lib/services/enrich-phases/link-expansion";
import { parsePhaseResults } from "@/lib/services/phase-results";
import { rejectSubmission } from "@/lib/services/submissions";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import type { PhaseResult } from "@/lib/types/curation";
import type { DenialReason } from "@/lib/types/submission";

/**
 * Automatic verdicts for targets the acquire gate skipped for having no
 * purchase channel.
 *
 * The gate itself never writes a verdict: it records evidence and lets the
 * brand finish the run. This service runs once per job, after every target has
 * reported, and turns the CONCLUSIVE skips into decisions — a new submission is
 * rejected, an approved brand behind a refresh is hidden and its refresh
 * rejected.
 *
 * Two properties are load-bearing:
 *
 *  1. Conclusiveness is RECOMPUTED here from `linkExpansion.sources`, never
 *     read from the stored `evidence` flag. The flag is written by the same
 *     run that could have been wrong about it; the per-source enum is the
 *     evidence. A trace with no `sources` at all (written before DEV-1702) is
 *     not evidence of absence and is never acted on.
 *  2. Every write goes through `rejectSubmission` and `hideBrandWithReason`, so
 *     field protection, image cleanup and the audit trail are identical to the
 *     admin path. The only direct Supabase access is the two SELECTs that pick
 *     the targets.
 *
 * `CHANNEL_VERDICTS=off` makes the whole pass report-only: it logs what it
 * would have done and writes nothing. That is the rollout position for the
 * first production cohort.
 */

/** The gate's verdict prefix on `curation_job_targets.error`. */
export const NO_PURCHASE_CHANNEL_PREFIX = "no_purchase_channel:";

const NO_PURCHASE_CHANNEL_REASON: DenialReason = "no_purchase_channel";

const SUBMISSION_CHUNK = 200;

const TARGET_PAGE_SIZE = 1_000;

export type VerdictTarget = {
  targetId: string;
  submissionId: string;
  brandName: string;
  slug: string;
  intent: string;
  brandId: string | null;
  submitterEmail: string | null;
  /** The full gate error, reused verbatim as the reviewer note. */
  error: string;
};

export type SelectVerdictTargetsInput = {
  /** Narrows to one job. Omitted: the latest target per submission, any job. */
  jobId?: string;
  errorPrefix: string;
  requireConclusive: boolean;
  client?: SupabaseClient<Database>;
  /** Where a dropped-target warning goes. Defaults to `console.warn`. */
  onWarn?: (message: string) => void;
};

export type ChannelVerdictAction =
  | "rejected"
  | "hidden"
  | "would_reject"
  | "would_hide"
  | "skipped";

export type ChannelVerdictTargetOutcome = {
  slug: string;
  action: ChannelVerdictAction;
  reason?: string;
};

export type ChannelVerdictResult = {
  noChannelRejected: number;
  noChannelHidden: number;
  verdictSkipped: number;
  hideFailed: number;
  reportOnly: boolean;
  targets: ChannelVerdictTargetOutcome[];
};

export type ChannelVerdictDeps = {
  selectVerdictTargets: (
    input: SelectVerdictTargetsInput,
  ) => Promise<VerdictTarget[]>;
  rejectSubmission: (
    id: string,
    reviewerId: string,
    denialReason: DenialReason,
    notes?: string,
  ) => Promise<unknown>;
  hideBrandWithReason: (
    brandId: string,
    reason: string,
    actor: { source: "enriched"; jobId: string },
  ) => Promise<{ ok: boolean; changed: boolean; reason?: string; slug: string }>;
  requestPublicBrandRevalidation: (
    slugs: string[],
  ) => Promise<{ ok: boolean; reason?: string }>;
};

const defaultDeps: ChannelVerdictDeps = {
  selectVerdictTargets,
  rejectSubmission,
  hideBrandWithReason,
  requestPublicBrandRevalidation,
};

/**
 * True only when every deterministic source answered and none was `unknown`.
 * A missing `sources` object means the trace predates the evidence enum, which
 * reads as inconclusive — a pipeline that cannot say what it checked may not
 * delist a brand.
 *
 * The key list is imported from the writer (`computeEvidence`) rather than
 * copied: a fifth source added there must never leave the finalizer judging
 * conclusiveness on four.
 */
export function isConclusive(
  linkExpansion: PhaseResult["linkExpansion"] | undefined,
): boolean {
  const sources = linkExpansion?.sources;
  if (!sources) return false;

  return EVIDENCE_SOURCE_KEYS.every((key) => {
    const outcome = sources[key];
    return typeof outcome === "string" && outcome !== "unknown";
  });
}

/** The last acquire entry's link-expansion trace, if the target has one. */
function acquireLinkExpansion(
  phaseResults: PhaseResult[],
): PhaseResult["linkExpansion"] | undefined {
  const acquireEntries = phaseResults.filter(
    (result) => result.phase === "acquire" && result.linkExpansion,
  );
  return acquireEntries[acquireEntries.length - 1]?.linkExpansion;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/**
 * Skipped submission targets whose gate error carries `errorPrefix` and whose
 * submission is still pending.
 *
 * Without `jobId` only the newest target per submission counts — an older skip
 * that a later run superseded is not a verdict on the current state. That is
 * the shape `scripts/reject-skipped-submissions.ts` needs; the job finalizer
 * passes its own job id and reads exactly that job's targets.
 */
export async function selectVerdictTargets({
  jobId,
  errorPrefix,
  requireConclusive,
  client,
  onWarn,
}: SelectVerdictTargetsInput): Promise<VerdictTarget[]> {
  const supabase = client ?? createServiceClient();
  const warn = onWarn ?? ((message: string) => console.warn(message));

  // Paged explicitly: PostgREST caps a single response at `db-max-rows`, and
  // the script path (no job id) reads every skipped target ever written.
  const rows: Array<Record<string, unknown>> = [];
  for (let offset = 0; ; offset += TARGET_PAGE_SIZE) {
    let query = supabase
      .from("curation_job_targets")
      .select(
        "id, job_id, target_id, target_type, brand_name, brand_slug, status, error, phase_results, created_at",
      )
      .eq("target_type", "submission")
      .eq("status", "skipped");
    if (jobId) query = query.eq("job_id", jobId);

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + TARGET_PAGE_SIZE - 1);
    if (error) throw error;

    const page = (data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < TARGET_PAGE_SIZE) break;
  }

  const latestBySubmission = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const submissionId = row.target_id;
    if (typeof submissionId !== "string") continue;
    // Newest first, so the first row seen for a submission is the current one.
    if (latestBySubmission.has(submissionId)) continue;
    latestBySubmission.set(submissionId, row);
  }

  const candidates: Array<{
    row: Record<string, unknown>;
    submissionId: string;
    gateError: string;
  }> = [];
  for (const [submissionId, row] of latestBySubmission) {
    if (row.status !== "skipped") continue;
    const gateError = typeof row.error === "string" ? row.error : "";
    if (!gateError.startsWith(errorPrefix)) continue;
    if (requireConclusive) {
      const phaseResults = parsePhaseResults(
        (row.phase_results ?? []) as Parameters<typeof parsePhaseResults>[0],
      );
      if (!isConclusive(acquireLinkExpansion(phaseResults))) continue;
    }
    candidates.push({ row, submissionId, gateError });
  }

  if (candidates.length === 0) return [];

  const submissions = new Map<string, Record<string, unknown>>();
  for (const ids of chunk(
    candidates.map((candidate) => candidate.submissionId),
    SUBMISSION_CHUNK,
  )) {
    const { data: submissionRows, error: submissionError } = await supabase
      .from("brand_submissions")
      .select("id, brand_name, intent, brand_id, submitter_email, status")
      .in("id", ids);
    if (submissionError) throw submissionError;

    for (const submission of (submissionRows ?? []) as Array<
      Record<string, unknown>
    >) {
      if (typeof submission.id === "string") {
        submissions.set(submission.id, submission);
      }
    }
  }

  return candidates.flatMap(({ row, submissionId, gateError }) => {
    const submission = submissions.get(submissionId);
    // A row that is no longer pending is an ordinary, expected drop. A row
    // that is GONE means the submission was deleted between the two SELECTs —
    // same outcome, but it deserves an audit trail.
    if (!submission) {
      const targetSlug =
        typeof row.brand_slug === "string" && row.brand_slug
          ? row.brand_slug
          : String(row.brand_name ?? submissionId);
      warn(
        `[NO-CHANNEL-VERDICT] submission ${submissionId} not found for target ${targetSlug}`,
      );
      return [];
    }
    if (submission.status !== "pending") return [];

    const brandName =
      typeof submission.brand_name === "string"
        ? submission.brand_name
        : String(row.brand_name ?? submissionId);

    return [
      {
        targetId: String(row.id),
        submissionId,
        brandName,
        slug:
          typeof row.brand_slug === "string" && row.brand_slug
            ? row.brand_slug
            : brandName,
        intent: String(submission.intent ?? ""),
        brandId:
          typeof submission.brand_id === "string" ? submission.brand_id : null,
        submitterEmail:
          typeof submission.submitter_email === "string"
            ? submission.submitter_email
            : null,
        error: gateError,
      },
    ];
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Applies the no-purchase-channel verdicts for one finished job.
 *
 * Each target is isolated: a throw counts as `verdictSkipped` and the run
 * continues, because one submission that changed state under the job must not
 * cost the rest of the cohort its verdict. A refresh whose hide failed is left
 * pending on purpose — rejecting the refresh of a brand that is still public
 * would strand the brand with no channel and no open review. The mirror case,
 * a hide that committed before its reject threw, still counts as a hide and
 * still revalidates: the delisting happened, and only the refresh is left for
 * a human.
 */
export async function applyNoPurchaseChannelVerdicts({
  jobId,
  onProgress,
  reportOnly = process.env.CHANNEL_VERDICTS === "off",
  deps = defaultDeps,
}: {
  jobId: string;
  onProgress?: (message: string) => void;
  reportOnly?: boolean;
  deps?: ChannelVerdictDeps;
}): Promise<ChannelVerdictResult> {
  const report = (message: string): void => {
    if (onProgress) onProgress(message);
    else console.log(message);
  };

  const targets = await deps.selectVerdictTargets({
    jobId,
    errorPrefix: NO_PURCHASE_CHANNEL_PREFIX,
    requireConclusive: true,
  });

  const result: ChannelVerdictResult = {
    noChannelRejected: 0,
    noChannelHidden: 0,
    verdictSkipped: 0,
    hideFailed: 0,
    reportOnly,
    targets: [],
  };

  const hiddenSlugs: string[] = [];

  for (const target of targets) {
    const note = `${target.error} (job ${jobId})`;
    const isRefresh = target.intent === "refresh" && Boolean(target.brandId);

    try {
      if (reportOnly) {
        const action = isRefresh ? "hide" : "reject";
        report(`[NO-CHANNEL-VERDICT] would ${action} ${target.slug}`);
        result.targets.push({
          slug: target.slug,
          action: isRefresh ? "would_hide" : "would_reject",
        });
        continue;
      }

      if (isRefresh) {
        const hide = await deps.hideBrandWithReason(
          target.brandId as string,
          NO_PURCHASE_CHANNEL_REASON,
          { source: "enriched", jobId },
        );

        if (!hide.ok) {
          result.hideFailed += 1;
          result.targets.push({
            slug: target.slug,
            action: "skipped",
            reason: hide.reason ?? "hide_failed",
          });
          report(
            `[NO-CHANNEL-VERDICT] hide failed ${target.slug}: ${hide.reason ?? "unknown"}`,
          );
          continue;
        }

        // The hide has COMMITTED. Record it before the reject is attempted:
        // if the reject throws, the outer catch would otherwise count the
        // target as merely skipped, leaving a brand hidden with no count, no
        // revalidation, and no line in the Slack summary.
        result.noChannelHidden += 1;
        hiddenSlugs.push(hide.slug || target.slug);
        report(`[NO-CHANNEL-HIDE] ${target.slug}`);

        try {
          await deps.rejectSubmission(
            target.submissionId,
            CURATION_AGENT_REVIEWER_ID,
            NO_PURCHASE_CHANNEL_REASON,
            note,
          );
          result.targets.push({ slug: target.slug, action: "hidden" });
        } catch (error) {
          // The brand IS hidden; only its refresh stays pending for a human.
          result.verdictSkipped += 1;
          result.targets.push({
            slug: target.slug,
            action: "hidden",
            reason: `reject failed after hide: ${errorText(error)}`,
          });
          report(
            `[NO-CHANNEL-VERDICT] reject failed after hide ${target.slug}: ${errorText(error)}`,
          );
        }
        continue;
      }

      await deps.rejectSubmission(
        target.submissionId,
        CURATION_AGENT_REVIEWER_ID,
        NO_PURCHASE_CHANNEL_REASON,
        note,
      );

      result.noChannelRejected += 1;
      result.targets.push({ slug: target.slug, action: "rejected" });
      report(`[NO-CHANNEL-REJECT] ${target.slug}`);
    } catch (error) {
      result.verdictSkipped += 1;
      result.targets.push({
        slug: target.slug,
        action: "skipped",
        reason: errorText(error),
      });
      report(
        `[NO-CHANNEL-VERDICT] skipped ${target.slug}: ${errorText(error)}`,
      );
    }
  }

  // One revalidation for the whole job: every hide has already committed, so a
  // failure here only means stale public pages until the ISR window closes.
  if (hiddenSlugs.length > 0) {
    const revalidation = await deps.requestPublicBrandRevalidation(hiddenSlugs);
    report(
      `[NO-CHANNEL-VERDICT] revalidated ${hiddenSlugs.length} slug(s): ok=${revalidation.ok}${
        revalidation.reason ? ` reason=${revalidation.reason}` : ""
      }`,
    );
  }

  return result;
}
