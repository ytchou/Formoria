/**
 * Enrich ONE pending submission in-process and print what the pipeline produced.
 *
 * This is the new-listing counterpart to `refresh.ts`. A pending submission has
 * no `brand_id`, so there is no live row to snapshot, protect, or apply to — the
 * run writes `brand_submissions.enriched_data` and audit rows, and nothing else.
 * That makes it safe to run against production from a working tree.
 *
 * It deliberately reuses the same three calls `refresh.ts` uses
 * (`enqueueAdminCurationJob` -> `claimCurationJob` -> `runJob`) rather than
 * calling a phase directly: a bare `runEnrich` skips the job bookkeeping the
 * rest of the system reads.
 *
 *   pnpm exec tsx --env-file=.env.local scripts/curation-rerun/enrich-submission.ts <submission-id>
 *   pnpm exec tsx --env-file=.env.local scripts/curation-rerun/enrich-submission.ts <submission-id> image
 *
 * A step filter re-runs only those steps. `enriched_data` is merged, not
 * replaced, so a follow-up `image` run keeps the text an earlier full run wrote.
 */
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  enqueueAdminCurationJob,
  claimCurationJob,
} from "@/lib/services/curation-jobs";
import { runJob } from "@/lib/services/job-runner";

const STEPS = ["context", "image", "detail"] as const;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    );
  return createClient(url, key);
}

function usd(value: number): string {
  return `$${value.toFixed(4)}`;
}

async function main(): Promise<void> {
  const submissionId = process.argv[2];
  if (!submissionId)
    throw new Error("usage: enrich-submission.ts <submission-id> [steps...]");

  const requestedSteps = process.argv.slice(3);
  const steps = requestedSteps.length > 0 ? requestedSteps : [...STEPS];
  const unknown = steps.filter(
    (step) => !STEPS.includes(step as (typeof STEPS)[number]),
  );
  if (unknown.length > 0) {
    throw new Error(
      `unknown step(s): ${unknown.join(", ")} — expected ${STEPS.join(", ")}`,
    );
  }

  const supabase = serviceClient();
  const adminEmail =
    (process.env.ADMIN_EMAILS ?? "").split(",")[0]?.trim() ||
    "admin@formoria.com";

  const { data: before, error: beforeError } = await supabase
    .from("brand_submissions")
    .select(
      "id, brand_name, status, intent, brand_id, website_url, enriched_data",
    )
    .eq("id", submissionId)
    .single();
  if (beforeError) throw beforeError;

  console.log(`\n[1/3] target: ${before.brand_name}`);
  console.log(
    `      status=${before.status} intent=${before.intent} brand_id=${before.brand_id ?? "null"}`,
  );
  console.log(
    `      enriched_data before: ${before.enriched_data ? `${Object.keys(before.enriched_data).length} key(s)` : "null"}`,
  );

  console.log(`\n[2/3] enqueueing curation job — steps: ${steps.join(", ")}`);
  const job = await enqueueAdminCurationJob({
    params: {
      target: "submissions",
      submissionIds: [submissionId],
      steps,
      overwrite: true,
    },
    dryRun: false,
    startedBy: adminEmail,
  });
  console.log(`      job ${job.id}`);

  const workerToken = randomUUID();
  const claimed = await claimCurationJob(job.id, workerToken);
  if (!claimed)
    throw new Error(
      `could not claim job ${job.id} — another worker may hold it`,
    );
  const summary = await runJob(claimed, workerToken);
  console.log(
    `      done — success ${summary.success}, failed ${summary.failed}, skipped ${summary.skipped}`,
  );

  console.log(`\n[3/3] result`);
  const { data: after, error: afterError } = await supabase
    .from("brand_submissions")
    .select("enriched_data")
    .eq("id", submissionId)
    .single();
  if (afterError) throw afterError;

  console.log(JSON.stringify(after.enriched_data, null, 2));

  const { data: target } = await supabase
    .from("curation_job_targets")
    .select("status, error, phase_results")
    .eq("job_id", job.id)
    .maybeSingle();
  if (target) {
    console.log(`\nphases:`);
    for (const phase of (target.phase_results ?? []) as {
      phase: string;
      status: string;
      note?: string;
    }[]) {
      console.log(
        `  ${phase.phase.padEnd(18)} ${phase.status}${phase.note ? ` — ${phase.note}` : ""}`,
      );
    }
    if (target.error) console.log(`\ntarget error: ${target.error}`);
  }

  // Cost is keyed on submission_id for a pre-approval run; a brand-linked run
  // keys on brand_id instead, so query both rather than assuming.
  const { data: calls } = await supabase
    .from("brand_ai_results")
    .select(
      "phase, model, prompt_tokens, cached_prompt_tokens, completion_tokens, cost_usd",
    )
    .eq("submission_id", submissionId)
    .eq("job_id", job.id);
  const rows = calls ?? [];
  if (rows.length > 0) {
    const total = rows.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0);
    const unmeasured = rows.filter((row) => row.cost_usd == null).length;
    console.log(
      `\ncost: ${usd(total)} across ${rows.length} call(s)${unmeasured > 0 ? ` (${unmeasured} unmeasured)` : ""}`,
    );
    const byPhase = new Map<string, { calls: number; cost: number }>();
    for (const row of rows) {
      const entry = byPhase.get(row.phase) ?? { calls: 0, cost: 0 };
      entry.calls += 1;
      entry.cost += row.cost_usd ?? 0;
      byPhase.set(row.phase, entry);
    }
    for (const [phase, entry] of [...byPhase].sort(
      (a, b) => b[1].cost - a[1].cost,
    )) {
      console.log(
        `  ${phase.padEnd(18)} ${String(entry.calls).padStart(3)} call(s)  ${usd(entry.cost)}`,
      );
    }
  } else {
    console.log("\ncost: no audit rows keyed on this submission");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
