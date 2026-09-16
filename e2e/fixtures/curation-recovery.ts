import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServiceClient } from "../../src/lib/supabase/service";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BUDGET } from "../budgets";
import {
  validateStagingTarget,
  projectRefFromDatabaseUrl,
} from "../../src/lib/supabase/project-target";

/** Runs against real staging Postgres; the connection always rolls back its fixtures and DDL. */
export function verifyAtomicRecovery(
  options: { installMigration?: boolean } = {},
): unknown {
  const migration =
    options.installMigration === false
      ? ""
      : readFileSync(
          path.resolve(
            "supabase/migrations/20260916090000_atomic_enrichment_checkpoints.sql",
          ),
          "utf8",
        );
  const assertions = readFileSync(
    path.resolve("e2e/fixtures/curation-recovery-commit.sql"),
    "utf8",
  );
  return JSON.parse(recoverySql(`begin;\nset local lock_timeout = '5s';\nset local statement_timeout = '20s';\n${migration}\n${assertions}\nrollback;\n`)) as unknown;
}

function recoverySql(sql: string): string {
  const target = validateStagingTarget();
  const databaseUrl = process.env.SUPABASE_DB_URL;
  if (
    !databaseUrl ||
    projectRefFromDatabaseUrl(databaseUrl) !== target.projectRef
  ) {
    throw new Error(
      "Recovery fixture requires the validated staging database connection",
    );
  }
  const connection = new URL(databaseUrl);
  const result = spawnSync(
    "psql",
    [
      "--no-psqlrc",
      "--set=ON_ERROR_STOP=1",
      "--quiet",
      "--tuples-only",
      "--no-align",
    ],
    {
      env: {
        ...process.env,
        PGHOST: connection.hostname,
        PGPORT: connection.port || "5432",
        PGDATABASE: connection.pathname.slice(1),
        PGUSER: decodeURIComponent(connection.username),
        PGPASSWORD: decodeURIComponent(connection.password),
        PGSSLMODE: "require",
        PGCONNECT_TIMEOUT: "10",
      },
      input: sql,
      encoding: "utf8",
      timeout: BUDGET.DB_FIXTURE,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `Recovery transaction verification failed: ${result.stderr}`,
    );
  return result.stdout.trim();
}

export async function withRecoveryServiceFixture<T>(run: (fixture: {
  sourceJobId: string; faqTargetId: string; productTargetId: string; startedBy: string;
  supabase: ReturnType<typeof createServiceClient>;
}) => Promise<T>): Promise<T> {
  validateStagingTarget();
  const queue = JSON.parse(recoverySql("begin read only; select json_build_object('cron', (select count(*) from cron.job where active), 'running', (select count(*) from public.curation_jobs where status = 'running')); rollback;")) as { cron: number; running: number };
  if (queue.cron || queue.running) throw new Error("Recovery service fixture requires staging cron disabled and no running curation worker jobs");
  const supabase = createServiceClient();
  const startedBy = `e2e-recovery-${randomUUID()}`;
  const faqTargetId = randomUUID();
  const productTargetId = randomUUID();
  const targetIds = [faqTargetId, productTargetId];
  try {
    const { error: insertError } = await supabase.from("brand_submissions").insert(targetIds.map((id) => ({
      id, brand_name: `[E2E-TEST] 陶作 ${id}`, submitter_email: "recovery-fixture@test.example", status: "pending", intent: "recommend",
    })));
    if (insertError) throw insertError;
    const { data: sourceJobId, error: enqueueError } = await supabase.rpc("enqueue_curation_job", {
      p_operation: "enrich", p_params: { target: "submissions", submissionIds: targetIds, retry: {
        version: 1, action: { kind: "rerun" }, targets: {
          [faqTargetId]: { selected: ["faq"], forced: ["faq"], explicit: ["faq"] },
          [productTargetId]: { selected: ["products"], forced: ["products"], explicit: ["products"] },
        },
      } }, p_dry_run: false, p_started_by: startedBy, p_trigger: "admin", p_parent_job_id: null,
      p_attempt: 1, p_scheduled_for: null, p_run_after: "2099-01-01T00:00:00Z", p_dedupe_key: startedBy,
      p_targets: targetIds.map((id) => ({ target_type: "submission", target_id: id, brand_name: `[E2E-TEST] 陶作 ${id}`, brand_slug: null })),
    });
    if (enqueueError || !sourceJobId) throw enqueueError ?? new Error("Missing source job");
    const { error: jobError } = await supabase.from("curation_jobs").update({ status: "failed" }).eq("id", sourceJobId);
    if (jobError) throw jobError;
    const { error: cancelledError } = await supabase.from("curation_job_targets").update({ status: "cancelled" }).eq("job_id", sourceJobId);
    if (cancelledError) throw cancelledError;
    const { error: failedError } = await supabase.from("curation_job_targets").update({ status: "failed", phase_results: [{ phase: "faq", status: "succeeded", changedFields: ["faq"], durationMs: 10 }] }).eq("job_id", sourceJobId).eq("target_id", faqTargetId);
    if (failedError) throw failedError;
    const { error: outputError } = await supabase.from("curation_phase_outputs").insert({
      job_id: sourceJobId, target_id: faqTargetId, target_type: "submission", phase: "faq", status: "succeeded",
      output: { patch: { faq: { entries: [], explicit: true } } },
    });
    if (outputError) throw outputError;
    return await run({ sourceJobId, faqTargetId, productTargetId, startedBy, supabase });
  } finally {
    const { data: jobs, error: jobsError } = await supabase.from("curation_jobs").select("id").eq("started_by", startedBy);
    if (jobsError) throw jobsError;
    const ids = (jobs ?? []).map((job) => job.id);
    if (ids.length) {
      for (const table of ["brand_ai_results", "curation_phase_outputs", "curation_job_targets", "curation_jobs"] as const) {
        const { error } = await supabase.from(table).delete().in(table === "curation_jobs" ? "id" : "job_id", ids);
        if (error) throw error;
      }
    }
    const { error } = await supabase.from("brand_submissions").delete().in("id", targetIds);
    if (error) throw error;
  }
}
