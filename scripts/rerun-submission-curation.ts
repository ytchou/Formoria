/**
 * Re-runs the real curation pipeline over pending submissions.
 *
 * Single source of truth by construction: this script contains no pipeline
 * logic of its own. It calls the same three exported functions the product
 * already uses, in the same order the system uses them:
 *
 *   enqueueAdminCurationJob()  <- what the admin "run curation again" path calls
 *   claimCurationJob()         <- what the worker calls to take a job
 *   runJob()                   <- what the worker calls to execute it
 *
 * Deliberately NOT the raw `enqueue_curation_job` RPC. scripts/run-refresh-
 * enrichment.ts reaches for the RPC directly because its header believed admin
 * jobs reject refresh intents. That is stale: the refresh guard lives in
 * isScheduledSubmissionEligible (the cron path). The explicit path used here
 * goes through isExplicitSubmissionEligible, which only requires
 * status = 'pending' and ignores intent, so refresh submissions enqueue fine.
 *
 * `overwrite` defaults ON, because the point of a re-run is to regenerate
 * values produced under a degraded provider rather than gap-fill around them.
 * Note that image-search ignores overwrite entirely -- its only guard is
 * "already has >= 2 active images" -- so submissions that genuinely got images
 * are skipped for free, and only the starved ones cost a search.
 *
 * Usage:
 *   pnpm rerun-curation                      # plan only, nothing enqueued
 *   pnpm rerun-curation --run                # enqueue + execute, overwrite on
 *   pnpm rerun-curation --run --limit=25     # cautious first batch
 *   pnpm rerun-curation --run --no-overwrite # gap-fill semantics instead
 */
import { randomUUID } from "node:crypto";

import { createServiceClient } from "@/lib/supabase/service";
import {
  claimCurationJob,
  enqueueAdminCurationJob,
} from "@/lib/services/curation-jobs";
import { runJob } from "@/lib/services/job-runner";

const RUN = process.argv.includes("--run");
const OVERWRITE = !process.argv.includes("--no-overwrite");
const ONLY = (
  process.argv
    .find((arg) => arg.startsWith("--only="))
    ?.slice("--only=".length) ?? ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const LIMIT = (() => {
  const raw = process.argv
    .find((arg) => arg.startsWith("--limit="))
    ?.slice("--limit=".length);
  if (!raw) return Number.POSITIVE_INFINITY;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--limit must be a positive integer, got "${raw}"`);
  }
  return parsed;
})();

async function main(): Promise<void> {
  const startedAt = Date.now();
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("brand_submissions")
    .select("id, brand_name, intent")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });
  if (error) throw error;

  const pending = data ?? [];
  const eligible =
    ONLY.length > 0
      ? pending.filter((submission) => ONLY.includes(submission.id))
      : pending;
  if (ONLY.length > 0 && eligible.length !== ONLY.length) {
    const matched = new Set(eligible.map((submission) => submission.id));
    throw new Error(
      `--only matched ${eligible.length} of ${ONLY.length} ids; unmatched (not pending?): ${ONLY.filter(
        (id) => !matched.has(id),
      ).join(", ")}`,
    );
  }
  const selected = eligible.slice(
    0,
    LIMIT === Number.POSITIVE_INFINITY ? undefined : LIMIT,
  );

  const byIntent = new Map<string, number>();
  for (const row of selected) {
    byIntent.set(row.intent, (byIntent.get(row.intent) ?? 0) + 1);
  }

  console.log(`[rerun-curation] pending submissions: ${pending.length}`);
  console.log(`[rerun-curation] selected:            ${selected.length}`);
  console.log(
    `[rerun-curation] by intent:           ${JSON.stringify(Object.fromEntries(byIntent))}`,
  );
  console.log(`[rerun-curation] overwrite:           ${OVERWRITE}`);

  if (selected.length === 0) {
    console.log("[rerun-curation] nothing to do");
    return;
  }
  if (!RUN) {
    console.log(
      "\n[rerun-curation] PLAN ONLY — pass --run to enqueue and execute",
    );
    return;
  }

  // enqueueAdminCurationJob resolves targets through resolveSubmissionTargets,
  // the same filter the admin surface uses, so anything no longer pending is
  // dropped here rather than by this script.
  const job = await enqueueAdminCurationJob({
    params: {
      submissionIds: selected.map((submission) => submission.id),
      overwrite: OVERWRITE,
    },
    dryRun: false,
    startedBy: "operator-rerun",
  });
  console.log(`[rerun-curation] enqueued job ${job.id}`);

  const workerToken = randomUUID();
  const claimed = await claimCurationJob(job.id, workerToken);
  if (!claimed) throw new Error(`Could not claim job ${job.id}`);

  const summary = await runJob(claimed, workerToken);
  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
  console.log(`[rerun-curation] finished in ${minutes}m`);
  console.log(`[rerun-curation] ${JSON.stringify(summary)}`);
}

void main().catch((err) => {
  console.error("[rerun-curation] fatal:", err);
  process.exitCode = 1;
});
