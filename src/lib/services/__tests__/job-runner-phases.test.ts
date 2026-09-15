import { describe, expect, it, vi } from "vitest";
import {
  finalizeSuccessfulJob,
  parseParams,
  resolvePhases,
  type JobFinalizeDeps,
} from "../job-runner";
import type { CurationJob } from "@/lib/services/curation-jobs";
import {
  DEFERRED_PHASES,
  forcePhasesForRetry,
  phasesForTask,
  phasesOfBlocks,
} from "@/lib/constants/enrich-phases";

/**
 * `resolvePhases` is the only place a stored job row turns into the phase list
 * the runner executes. A deferred name reaching this far means the phase is
 * scheduled but has no runner (or, for `links`, that `acquire` silently never
 * runs) — the DEV-1644 failure this normalization exists to make impossible.
 */
describe("resolvePhases", () => {
  const deferred = new Set<string>(DEFERRED_PHASES);

  it("resolvePhases_never_returns_deferred", () => {
    const resolutions = [
      // No scope at all.
      resolvePhases({}),
      // Task-based (the admin UI's vocabulary).
      resolvePhases({ task: "visual" }),
      resolvePhases({ task: "identity" }),
      resolvePhases({ task: "editorial" }),
      resolvePhases({ task: "full" }),
      // Legacy `params.steps` rows.
      resolvePhases({ steps: ["image"] }),
      resolvePhases({ steps: ["context", "image", "detail"] }),
      resolvePhases({ steps: ["unknown_step"] }),
      // Explicit phases naming only retired/deferred names.
      resolvePhases({ phases: ["links", "images", "classify_images"] }),
      resolvePhases({ phases: ["clean", "discover", "site_identity"] }),
    ];

    for (const resolved of resolutions) {
      expect(resolved.length).toBeGreaterThan(0);
      expect(resolved.filter((phase) => deferred.has(phase))).toEqual([]);
    }
  });

  it("no_scope_defaults_to_the_full_task_closure", () => {
    // Never `[...ENRICH_PHASES]`: that list still carries the deferred names.
    expect(resolvePhases({})).toEqual(phasesForTask("full"));
    expect(resolvePhases({ steps: ["unknown_step"] })).toEqual(
      phasesForTask("full"),
    );
  });

  it("legacy_links_scope_resolves_to_acquire", () => {
    expect(resolvePhases({ phases: ["links"] })).toEqual(["acquire"]);
    expect(resolvePhases({ phases: ["links", "products"] })).toEqual([
      "acquire",
      "products",
    ]);
  });
});

describe("parseParams budgetScale", () => {
  it("budget_scale_param_reaches_config", () => {
    // Valid finite positive number is kept
    expect(parseParams({ budgetScale: 1.5 }).budgetScale).toBe(1.5);

    // Zero is rejected
    expect(parseParams({ budgetScale: 0 }).budgetScale).toBeUndefined();

    // Negative is rejected
    expect(parseParams({ budgetScale: -1 }).budgetScale).toBeUndefined();

    // String is rejected
    expect(parseParams({ budgetScale: "x" }).budgetScale).toBeUndefined();

    // NaN is rejected (not finite)
    expect(parseParams({ budgetScale: NaN }).budgetScale).toBeUndefined();

    // Absent is undefined
    expect(parseParams({}).budgetScale).toBeUndefined();
  });
});

/**
 * The finalizer's ORDER is the contract: a verdict applied before every target
 * has reported would act on a half-finished run, and one applied after the job
 * is finalized would leave the summary lying about what it did.
 */
describe("finalizeSuccessfulJob", () => {
  function job(overrides: Partial<CurationJob> = {}): CurationJob {
    return {
      id: "job-1",
      operation: "enrich",
      dry_run: false,
      ...overrides,
    } as unknown as CurationJob;
  }

  function deps(calls: string[]): JobFinalizeDeps {
    return {
      markUnreportedTargetsSkipped: vi.fn(async () => {
        calls.push("markUnreportedTargetsSkipped");
      }),
      applyNoPurchaseChannelVerdicts: vi.fn(async () => {
        calls.push("applyNoPurchaseChannelVerdicts");
        return {
          noChannelRejected: 2,
          noChannelHidden: 1,
          verdictSkipped: 0,
          hideFailed: 0,
          reportOnly: false,
          targets: [],
        };
      }),
      listCurationJobTargets: vi.fn(async () => []),
      finalizeCurationJob: vi.fn(async () => {
        calls.push("finalizeCurationJob");
        return true;
      }) as unknown as JobFinalizeDeps["finalizeCurationJob"],
      archiveRunLog: vi.fn(async () => {}),
      reportProviderFailures: vi.fn(async () => {}),
      reportChannelVerdicts: vi.fn(async () => {
        calls.push("reportChannelVerdicts");
      }),
    };
  }

  it("job_runner_calls_verdicts_after_marking_unreported_and_not_on_dry_run", async () => {
    const calls: string[] = [];
    const wired = deps(calls);

    const summary = await finalizeSuccessfulJob(
      job(),
      "worker-token",
      { startedAt: Date.now(), isLeaseLost: () => false },
      wired,
    );

    expect(calls).toEqual([
      "markUnreportedTargetsSkipped",
      "applyNoPurchaseChannelVerdicts",
      "finalizeCurationJob",
      "reportChannelVerdicts",
    ]);
    expect(summary.noChannelRejected).toBe(2);
    expect(summary.noChannelHidden).toBe(1);

    const dryCalls: string[] = [];
    const dryDeps = deps(dryCalls);
    const drySummary = await finalizeSuccessfulJob(
      job({ dry_run: true }),
      "worker-token",
      { startedAt: Date.now(), isLeaseLost: () => false },
      dryDeps,
    );

    expect(dryDeps.applyNoPurchaseChannelVerdicts).not.toHaveBeenCalled();
    expect(dryDeps.reportChannelVerdicts).not.toHaveBeenCalled();
    expect(drySummary.noChannelRejected).toBeUndefined();
  });

  /**
   * The verdict pass runs after every target has already been enriched and
   * reported. A failure inside it must not cost the job its `completed` row:
   * that row is the only record of the enrichment, and a `failed` job gets
   * re-run from the top.
   */
  it("verdict_pass_failure_does_not_fail_the_job", async () => {
    const calls: string[] = [];
    const wired = deps(calls);
    wired.applyNoPurchaseChannelVerdicts = vi.fn(async () => {
      throw new Error("PostgREST timeout");
    });

    const summary = await finalizeSuccessfulJob(
      job(),
      "worker-token",
      { startedAt: Date.now(), isLeaseLost: () => false },
      wired,
    );

    expect(wired.finalizeCurationJob).toHaveBeenCalledWith(
      "job-1",
      "worker-token",
      expect.objectContaining({ status: "completed" }),
    );
    expect(calls).toEqual(["markUnreportedTargetsSkipped", "finalizeCurationJob"]);
    expect(summary.noChannelRejected).toBeUndefined();
    expect(summary.noChannelHidden).toBeUndefined();
    expect(wired.reportChannelVerdicts).not.toHaveBeenCalled();
  });

  /**
   * The lease check throws BEFORE the pass, never after: a worker that no
   * longer owns the job must not hide brands and reject submissions another
   * worker is already re-running.
   */
  it("lease_lost_before_verdicts_prevents_every_verdict_write", async () => {
    const calls: string[] = [];
    const wired = deps(calls);

    await expect(
      finalizeSuccessfulJob(
        job(),
        "worker-token",
        { startedAt: Date.now(), isLeaseLost: () => true },
        wired,
      ),
    ).rejects.toThrow("Job lease was lost before completion");

    expect(wired.applyNoPurchaseChannelVerdicts).not.toHaveBeenCalled();
    expect(wired.finalizeCurationJob).not.toHaveBeenCalled();
    expect(wired.reportChannelVerdicts).not.toHaveBeenCalled();
    expect(calls).toEqual(["markUnreportedTargetsSkipped"]);
  });
});

// ---------------------------------------------------------------------------
// Retry params parsing (parseRetryParam consumed by parseParams)
// ---------------------------------------------------------------------------

describe("parseParams retry", () => {
  it("parse_params_accepts_retry_and_rejects_unknown_block", () => {
    // Valid retry round-trips
    const valid = parseParams({
      retry: { block: "products", mode: "only" },
    });
    expect(valid.retry).toEqual({ block: "products", mode: "only" });

    // subPhase accepted for editorial block
    const withSub = parseParams({
      retry: { block: "editorial", mode: "only", subPhase: "faq" },
    });
    expect(withSub.retry).toEqual({
      block: "editorial",
      mode: "only",
      subPhase: "faq",
    });

    // Unknown block → dropped
    expect(parseParams({ retry: { block: "bogus", mode: "only" } }).retry).toBeUndefined();

    // gather/persist are not retryable → dropped
    expect(parseParams({ retry: { block: "gather", mode: "only" } }).retry).toBeUndefined();
    expect(parseParams({ retry: { block: "persist", mode: "only" } }).retry).toBeUndefined();

    // Unknown mode → dropped
    expect(
      parseParams({ retry: { block: "detect", mode: "restart" } }).retry,
    ).toBeUndefined();

    // subPhase on a non-editorial block → dropped
    expect(
      parseParams({ retry: { block: "products", mode: "only", subPhase: "faq" } }).retry,
    ).toBeUndefined();

    // Not an object → dropped
    expect(parseParams({ retry: "detect" }).retry).toBeUndefined();
    expect(parseParams({ retry: null }).retry).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// forcePhasesForRetry (defined in enrich-phases.ts, exercised through parseParams)
// ---------------------------------------------------------------------------

describe("forcePhasesForRetry", () => {
  it("force_set_only_is_the_blocks_phases", () => {
    // products block's phases
    expect(forcePhasesForRetry({ block: "products", mode: "only" })).toEqual(
      phasesOfBlocks(["products"]),
    );

    // editorial with subPhase narrows to the single subPhase
    expect(
      forcePhasesForRetry({ block: "editorial", mode: "only", subPhase: "faq" }),
    ).toEqual(["faq"]);
  });

  it("force_set_with_upstream_is_the_closure", () => {
    // products depends on acquire and names; those depend on detect
    const phases = forcePhasesForRetry({
      block: "products",
      mode: "with_upstream",
    });
    expect(phases).toContain("detect");
    expect(phases).toContain("acquire");
    expect(phases).toContain("names");
    expect(phases).toContain("products");
    // Should NOT contain unrelated blocks
    expect(phases).not.toContain("descriptions");
    expect(phases).not.toContain("faq");
  });
});

// ---------------------------------------------------------------------------
// resolvePhases with retry set
// ---------------------------------------------------------------------------

describe("resolvePhases with retry", () => {
  it("retry_feeds_force_set_as_resolved_phases", () => {
    const phases = resolvePhases({
      retry: { block: "products", mode: "only" },
    });
    expect(phases).toEqual(phasesOfBlocks(["products"]));
  });

  it("retry_with_upstream_resolves_to_closure", () => {
    const phases = resolvePhases({
      retry: { block: "editorial", mode: "with_upstream" },
    });
    // Editorial depends on acquire which depends on detect
    expect(phases).toContain("detect");
    expect(phases).toContain("acquire");
    expect(phases).toContain("descriptions");
    expect(phases).toContain("stockists");
    expect(phases).toContain("faq");
  });

  it("retry_overrides_explicit_phases_and_task", () => {
    // Even when phases and task are set, retry wins
    const phases = resolvePhases({
      phases: ["detect"],
      task: "full",
      retry: { block: "editorial", mode: "only" },
    });
    expect(phases).toEqual(phasesOfBlocks(["editorial"]));
  });
});
