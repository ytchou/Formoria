import { test, expect } from "@playwright/test";
import { runEnrich } from "../../src/lib/services/curation-operations";
import { readTargetPlan } from "../../src/lib/services/enrich-blocks/plan";
import { enqueueCurationRecovery } from "../../src/lib/services/curation-jobs";
import { verifyAtomicRecovery, withRecoveryServiceFixture } from "../fixtures/curation-recovery";

// Catches submission updates and checkpoint acknowledgements diverging on rejection or rollback.
test("recovery commits only eligible checkpoints atomically with a pending submission", () => {
  expect(verifyAtomicRecovery()).toEqual({
    description: "committed",
    checkpointConsumed: true,
  });
});

test("one recovery job keeps mixed targets isolated and preserves FAQ scope through a failed retry chain", async () => {
  await withRecoveryServiceFixture(async ({ sourceJobId, faqTargetId, productTargetId, startedBy, supabase }) => {
    const resumed = await enqueueCurationRecovery({ sourceJobId, startedBy, action: { kind: "resume" } });
    expect(resumed.counts).toEqual({ total: 2, failed: 1, cancelled: 1 });
    const children = await supabase.from("curation_jobs").select("id, params, parent_job_id, dry_run, trigger").eq("parent_job_id", sourceJobId);
    expect(children.error).toBeNull();
    expect(children.data).toHaveLength(1);
    expect(children.data?.at(0)).toMatchObject({ id: resumed.job.id, parent_job_id: sourceJobId, dry_run: false, trigger: "manual_rerun", params: {
      retry: { version: 1, action: { kind: "resume" }, targets: {
        [faqTargetId]: { selected: ["faq"], forced: [], explicit: ["faq"] },
        [productTargetId]: { selected: ["products"], forced: ["products"], explicit: ["products"] },
      } },
    } });
    const phaseRetry = await enqueueCurationRecovery({ sourceJobId, startedBy, action: { kind: "phase", targetId: faqTargetId, retry: { block: "editorial", mode: "only", subPhase: "faq" } } });
    const failedPhase = await supabase.from("curation_job_targets").update({ status: "failed", phase_results: [{ phase: "faq", status: "failed", changedFields: [], durationMs: 10, error: "Fixture provider failure" }] }).eq("job_id", phaseRetry.job.id);
    expect(failedPhase.error).toBeNull();
    const failedJob = await supabase.from("curation_jobs").update({ status: "failed" }).eq("id", phaseRetry.job.id);
    expect(failedJob.error).toBeNull();
    const rerun = await enqueueCurationRecovery({ sourceJobId: phaseRetry.job.id, startedBy, action: { kind: "rerun" } });
    const rerunFailure = await supabase.from("curation_job_targets").update({ status: "failed", phase_results: [{ phase: "faq", status: "failed", changedFields: [], durationMs: 10, error: "Fixture provider failure" }] }).eq("job_id", rerun.job.id);
    expect(rerunFailure.error).toBeNull();
    const rerunJobFailure = await supabase.from("curation_jobs").update({ status: "failed" }).eq("id", rerun.job.id);
    expect(rerunJobFailure.error).toBeNull();
    const chainResume = await enqueueCurationRecovery({ sourceJobId: rerun.job.id, startedBy, action: { kind: "resume" } });
    const chain = await supabase.from("curation_jobs").select("params").eq("id", chainResume.job.id).single();
    expect(chain.error).toBeNull();
    expect(chain.data?.params).toMatchObject({ submissionIds: [faqTargetId], overwrite: false, retry: { targets: {
      [faqTargetId]: { selected: ["faq"], forced: ["faq"], explicit: ["faq"] },
    } } });
    expect(chainResume.counts.total).toBe(1);
  });
});

test("a products-only recovery without saved acquisition inputs fails before provider work", async () => {
  await withRecoveryServiceFixture(async ({ sourceJobId, productTargetId, startedBy, supabase }) => {
    const { job } = await enqueueCurationRecovery({ sourceJobId, startedBy, action: { kind: "phase", targetId: productTargetId, retry: { block: "products", mode: "only" } } });
    const started = await supabase.from("curation_jobs").update({ status: "running", started_at: new Date().toISOString() }).eq("id", job.id);
    expect(started.error).toBeNull();
    const result = await runEnrich({
      target: "submissions", submissionIds: [productTargetId], dryRun: false, jobId: job.id,
      phases: ["products"], targetPlans: { [productTargetId]: readTargetPlan(job.params, productTargetId) },
      recoveryJobIds: [sourceJobId],
    }, supabase);
    expect(result.brandOutcomes).toHaveLength(1);
    expect(result.brandOutcomes.at(0)).toMatchObject({ status: "failed", error: "Saved acquisition inputs are unavailable. Retry with upstream steps.", phaseResults: [
      { phase: "products", status: "failed" },
    ] });
    const checkpoints = await supabase.from("curation_phase_outputs").select("id").eq("job_id", job.id);
    expect(checkpoints.error).toBeNull();
    expect(checkpoints.data).toEqual([]);
    const providerCalls = await supabase.from("brand_ai_results").select("id").eq("job_id", job.id);
    expect(providerCalls.error).toBeNull();
    expect(providerCalls.data).toEqual([]);
    const searches = await supabase.from("brand_search_results").select("id").eq("job_id", job.id);
    expect(searches.error).toBeNull();
    expect(searches.data).toEqual([]);
  });
});
