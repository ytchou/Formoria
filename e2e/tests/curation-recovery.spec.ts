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

test("a forced FAQ retry executes despite its source checkpoint without enabling overwrite", async () => {
  await withRecoveryServiceFixture(async ({ sourceJobId, faqTargetId, startedBy, supabase }) => {
    const { job } = await enqueueCurationRecovery({ sourceJobId, startedBy, action: {
      kind: "phase", targetId: faqTargetId, retry: { block: "editorial", mode: "only", subPhase: "faq" },
    } });
    const started = await supabase.from("curation_jobs").update({
      status: "running", dry_run: true, started_at: new Date().toISOString(),
    }).eq("id", job.id);
    expect(started.error).toBeNull();

    const originalFetch = globalThis.fetch;
    const originalOpenAiKey = process.env.OPENAI_API_KEY;
    const originalLangfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY;
    const originalLangfuseSecretKey = process.env.LANGFUSE_SECRET_KEY;
    let providerRequests = 0;
    process.env.OPENAI_API_KEY = "e2e-provider-fixture";
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "https://api.openai.com/v1/chat/completions") {
        providerRequests += 1;
        return new Response(JSON.stringify({
          id: `chatcmpl-fixture-${providerRequests}`,
          object: "chat.completion",
          created: 1_789_488_000,
          model: "gpt-5-mini",
          choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ entries: [{
            preset_id: "custom",
            question_zh: "這個品牌如何製作作品？",
            answer_zh: "從備料、打樣到成品檢查都由同一組師傅在工坊完成，並依作品狀態調整每一道工序。",
            question_en: "How does this brand make its work?",
            answer_en: "The same workshop team handles preparation, prototyping, and final inspection for every piece.",
          }] }) }, finish_reason: "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return originalFetch(input, init);
    };

    try {
      const result = await runEnrich({
        target: "submissions", submissionIds: [faqTargetId], dryRun: true, jobId: job.id,
        phases: ["faq"], targetPlans: { [faqTargetId]: readTargetPlan(job.params, faqTargetId) },
        recoveryJobIds: [sourceJobId],
      }, supabase);
      expect(providerRequests).toBeGreaterThan(0);
      expect(result.brandOutcomes.at(0)?.phaseResults).toEqual(expect.arrayContaining([
        expect.objectContaining({ phase: "faq", status: "succeeded" }),
      ]));
      expect(job.params).toMatchObject({ overwrite: false });

      const checkpoints = await supabase.from("curation_phase_outputs").select("job_id, phase, status, persisted_at").eq("job_id", job.id);
      expect(checkpoints.error).toBeNull();
      expect(checkpoints.data).toEqual([expect.objectContaining({ phase: "faq", status: "succeeded", persisted_at: null })]);
      const providerAudits = await supabase.from("brand_ai_results").select("id").eq("job_id", job.id).eq("phase", "faq");
      expect(providerAudits.error).toBeNull();
      expect(providerAudits.data?.length).toBeGreaterThan(0);
      const submission = await supabase.from("brand_submissions").select("enriched_data").eq("id", faqTargetId).single();
      expect(submission.error).toBeNull();
      expect(submission.data?.enriched_data).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalOpenAiKey;
      if (originalLangfusePublicKey === undefined) delete process.env.LANGFUSE_PUBLIC_KEY;
      else process.env.LANGFUSE_PUBLIC_KEY = originalLangfusePublicKey;
      if (originalLangfuseSecretKey === undefined) delete process.env.LANGFUSE_SECRET_KEY;
      else process.env.LANGFUSE_SECRET_KEY = originalLangfuseSecretKey;
    }
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
