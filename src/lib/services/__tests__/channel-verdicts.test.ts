import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { CURATION_AGENT_REVIEWER_ID } from "@/lib/constants/curation";
import type { SourceOutcome } from "@/lib/types/curation";
import {
  loadNotABrandCandidates,
  NOT_A_BRAND_PREFIX,
} from "../../../../scripts/shared/reject-skipped-selection";
import {
  applyNoPurchaseChannelVerdicts,
  isConclusive,
  NO_PURCHASE_CHANNEL_PREFIX,
  selectVerdictTargets,
  type ChannelVerdictDeps,
  type VerdictTarget,
} from "../channel-verdicts";

/**
 * The two SELECTs are the only Supabase surface this service touches, so the
 * fake is the thenable self-returning chain used by `search-results.test.ts`,
 * keyed by table name. Service-module collaborators are injected through
 * `deps` rather than mocked: `scripts/check-test-boundaries.mjs` refuses a
 * `vi.mock` of anything under `@/lib/services/`.
 */
type Row = Record<string, unknown>;

function fakeSupabase(tables: Record<string, Row[]>): SupabaseClient<Database> {
  const chainFor = (rows: Row[]): Record<string, unknown> => {
    const chain: Record<string, unknown> = {
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    for (const method of ["select", "in", "eq", "order", "limit", "range"]) {
      chain[method] = () => chain;
    }
    return chain;
  };

  return {
    from: (table: string) => chainFor(tables[table] ?? []),
  } as unknown as SupabaseClient<Database>;
}

const CONCLUSIVE_SOURCES: Record<string, SourceOutcome> = {
  hubs: "skipped",
  threads: "absent",
  serpName: "absent",
  serpHandle: "absent",
};

const NO_CHANNEL_ERROR = `${NO_PURCHASE_CHANNEL_PREFIX} no purchase channel after hubs=skipped threads=absent serp_name=absent serp_handle=absent evidence=conclusive`;

function phaseResults(
  linkExpansion: Record<string, unknown> | undefined,
): Json {
  return [
    {
      phase: "acquire",
      status: "skipped",
      changedFields: [],
      durationMs: 12,
      ...(linkExpansion ? { linkExpansion } : {}),
    },
  ] as unknown as Json;
}

function conclusiveTrace(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    hubsFetched: 0,
    adopted: [],
    serp: "searched",
    sources: { ...CONCLUSIVE_SOURCES },
    evidence: "conclusive",
    ...overrides,
  };
}

function targetRow(overrides: Row = {}): Row {
  return {
    id: "target-1",
    job_id: "job-1",
    target_type: "submission",
    target_id: "sub-1",
    brand_name: "Brand A",
    brand_slug: "brand-a",
    status: "skipped",
    error: NO_CHANNEL_ERROR,
    phase_results: phaseResults(conclusiveTrace()),
    created_at: "2026-09-05T00:00:00Z",
    ...overrides,
  };
}

function submissionRow(overrides: Row = {}): Row {
  return {
    id: "sub-1",
    brand_name: "Brand A",
    intent: "recommend",
    brand_id: null,
    submitter_email: "guest@formoria.com",
    status: "pending",
    ...overrides,
  };
}

function verdictTarget(overrides: Partial<VerdictTarget> = {}): VerdictTarget {
  return {
    targetId: "target-1",
    submissionId: "sub-1",
    brandName: "Brand A",
    slug: "brand-a",
    intent: "recommend",
    brandId: null,
    submitterEmail: "guest@formoria.com",
    error: NO_CHANNEL_ERROR,
    ...overrides,
  };
}

function deps(overrides: Partial<ChannelVerdictDeps> = {}): ChannelVerdictDeps {
  return {
    selectVerdictTargets: vi.fn(async () => [] as VerdictTarget[]),
    rejectSubmission: vi.fn(async () => ({})),
    hideBrandWithReason: vi.fn(async () => ({
      ok: true,
      changed: true,
      slug: "brand-a",
    })),
    requestPublicBrandRevalidation: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.CHANNEL_VERDICTS;
  vi.restoreAllMocks();
});

describe("selectVerdictTargets", () => {
  it("select_verdict_targets_returns_only_skipped_pending_conclusive_targets", async () => {
    const supabase = fakeSupabase({
      curation_job_targets: [
        targetRow({ id: "t-good", target_id: "sub-good" }),
        targetRow({
          id: "t-inconclusive",
          target_id: "sub-inconclusive",
          phase_results: phaseResults(
            conclusiveTrace({
              sources: { ...CONCLUSIVE_SOURCES, threads: "unknown" },
              evidence: "inconclusive",
            }),
          ),
        }),
        targetRow({
          id: "t-no-sources",
          target_id: "sub-no-sources",
          phase_results: phaseResults({
            hubsFetched: 0,
            adopted: [],
            serp: "searched",
          }),
        }),
        targetRow({
          id: "t-succeeded",
          target_id: "sub-succeeded",
          status: "succeeded",
        }),
        targetRow({ id: "t-rejected", target_id: "sub-rejected" }),
        targetRow({
          id: "t-other-prefix",
          target_id: "sub-other-prefix",
          error: "Detection classified this entry as not a brand: shop",
        }),
      ],
      brand_submissions: [
        submissionRow({ id: "sub-good" }),
        submissionRow({ id: "sub-inconclusive" }),
        submissionRow({ id: "sub-no-sources" }),
        submissionRow({ id: "sub-succeeded" }),
        submissionRow({ id: "sub-rejected", status: "rejected" }),
        submissionRow({ id: "sub-other-prefix" }),
      ],
    });

    const targets = await selectVerdictTargets({
      jobId: "job-1",
      errorPrefix: NO_PURCHASE_CHANNEL_PREFIX,
      requireConclusive: true,
      client: supabase,
    });

    expect(targets.map((target) => target.submissionId)).toEqual(["sub-good"]);
  });

  /**
   * A submission deleted between the two SELECTs and a submission that is
   * simply no longer pending both drop out — but only the first is an anomaly,
   * and it is the one that has to leave a trace.
   */
  it("missing_submission_warns_while_non_pending_stays_silent", async () => {
    const warnings: string[] = [];
    const supabase = fakeSupabase({
      curation_job_targets: [
        targetRow({
          id: "t-gone",
          target_id: "sub-gone",
          brand_slug: "brand-gone",
        }),
        targetRow({
          id: "t-rejected",
          target_id: "sub-rejected",
          brand_slug: "brand-rejected",
        }),
      ],
      brand_submissions: [
        submissionRow({ id: "sub-rejected", status: "rejected" }),
      ],
    });

    const targets = await selectVerdictTargets({
      jobId: "job-1",
      errorPrefix: NO_PURCHASE_CHANNEL_PREFIX,
      requireConclusive: true,
      client: supabase,
      onWarn: (message) => warnings.push(message),
    });

    expect(targets).toEqual([]);
    expect(warnings).toEqual([
      "[NO-CHANNEL-VERDICT] submission sub-gone not found for target brand-gone",
    ]);
  });

  it("conclusive_is_recomputed_from_sources_not_stored_flag", async () => {
    const linkExpansion = conclusiveTrace({
      sources: { ...CONCLUSIVE_SOURCES, threads: "unknown" },
      evidence: "conclusive",
    });

    expect(
      isConclusive(
        linkExpansion as unknown as Parameters<typeof isConclusive>[0],
      ),
    ).toBe(false);

    const supabase = fakeSupabase({
      curation_job_targets: [
        targetRow({ phase_results: phaseResults(linkExpansion) }),
      ],
      brand_submissions: [submissionRow()],
    });

    const targets = await selectVerdictTargets({
      jobId: "job-1",
      errorPrefix: NO_PURCHASE_CHANNEL_PREFIX,
      requireConclusive: true,
      client: supabase,
    });

    expect(targets).toEqual([]);
  });
});

describe("applyNoPurchaseChannelVerdicts", () => {
  it("new_submission_is_rejected_with_agent_reviewer_and_note", async () => {
    const rejectSubmission = vi.fn(async () => ({}));
    const progress: string[] = [];

    const result = await applyNoPurchaseChannelVerdicts({
      jobId: "job-1",
      onProgress: (message) => progress.push(message),
      reportOnly: false,
      deps: deps({
        selectVerdictTargets: vi.fn(async () => [verdictTarget()]),
        rejectSubmission,
      }),
    });

    expect(rejectSubmission).toHaveBeenCalledWith(
      "sub-1",
      CURATION_AGENT_REVIEWER_ID,
      "no_purchase_channel",
      expect.stringMatching(
        new RegExp(`^${NO_PURCHASE_CHANNEL_PREFIX}.*\\(job job-1\\)`),
      ),
    );
    expect(result.noChannelRejected).toBe(1);
    expect(result.targets).toEqual([{ slug: "brand-a", action: "rejected" }]);
    expect(progress).toContain("[NO-CHANNEL-REJECT] brand-a");
  });

  it("refresh_hides_brand_then_rejects_refresh_and_revalidates", async () => {
    const order: string[] = [];
    const hideBrandWithReason = vi.fn(async () => {
      order.push("hide");
      return { ok: true, changed: true, slug: "brand-a" };
    });
    const rejectSubmission = vi.fn(async () => {
      order.push("reject");
      return {};
    });
    const requestPublicBrandRevalidation = vi.fn(async () => {
      order.push("revalidate");
      return { ok: true };
    });

    const result = await applyNoPurchaseChannelVerdicts({
      jobId: "job-1",
      reportOnly: false,
      deps: deps({
        selectVerdictTargets: vi.fn(async () => [
          verdictTarget({ intent: "refresh", brandId: "brand-uuid" }),
        ]),
        hideBrandWithReason,
        rejectSubmission,
        requestPublicBrandRevalidation,
      }),
    });

    expect(order).toEqual(["hide", "reject", "revalidate"]);
    expect(hideBrandWithReason).toHaveBeenCalledWith(
      "brand-uuid",
      "no_purchase_channel",
      { source: "enriched", jobId: "job-1" },
    );
    expect(requestPublicBrandRevalidation).toHaveBeenCalledWith(["brand-a"]);
    expect(result.noChannelHidden).toBe(1);
    expect(result.noChannelRejected).toBe(0);
    expect(result.targets).toEqual([{ slug: "brand-a", action: "hidden" }]);
  });

  it("hide_failure_leaves_refresh_pending", async () => {
    const rejectSubmission = vi.fn(async () => ({}));
    const requestPublicBrandRevalidation = vi.fn(async () => ({ ok: true }));

    const result = await applyNoPurchaseChannelVerdicts({
      jobId: "job-1",
      reportOnly: false,
      deps: deps({
        selectVerdictTargets: vi.fn(async () => [
          verdictTarget({ intent: "refresh", brandId: "brand-uuid" }),
        ]),
        hideBrandWithReason: vi.fn(async () => ({
          ok: false,
          changed: false,
          reason: "status_write_skipped",
          slug: "brand-a",
        })),
        rejectSubmission,
        requestPublicBrandRevalidation,
      }),
    });

    expect(rejectSubmission).not.toHaveBeenCalled();
    expect(requestPublicBrandRevalidation).not.toHaveBeenCalled();
    expect(result.hideFailed).toBe(1);
    expect(result.noChannelHidden).toBe(0);
    expect(result.targets).toEqual([
      { slug: "brand-a", action: "skipped", reason: "status_write_skipped" },
    ]);
  });

  /**
   * The hide has already committed when the reject throws. Counting the target
   * as merely skipped would hide a brand with no count, no revalidation and no
   * line in the Slack summary — a silent delisting.
   */
  it("hide_recorded_when_reject_fails_after_hide", async () => {
    const progress: string[] = [];
    const requestPublicBrandRevalidation = vi.fn(async () => ({ ok: true }));

    const result = await applyNoPurchaseChannelVerdicts({
      jobId: "job-1",
      onProgress: (message) => progress.push(message),
      reportOnly: false,
      deps: deps({
        selectVerdictTargets: vi.fn(async () => [
          verdictTarget({ intent: "refresh", brandId: "brand-uuid" }),
        ]),
        rejectSubmission: vi.fn(async () => {
          throw new Error("P0002: submission is not pending");
        }),
        requestPublicBrandRevalidation,
      }),
    });

    expect(result.noChannelHidden).toBe(1);
    expect(result.verdictSkipped).toBe(1);
    expect(result.hideFailed).toBe(0);
    expect(requestPublicBrandRevalidation).toHaveBeenCalledWith(["brand-a"]);
    expect(result.targets).toEqual([
      {
        slug: "brand-a",
        action: "hidden",
        reason: "reject failed after hide: P0002: submission is not pending",
      },
    ]);
    expect(progress).toContain("[NO-CHANNEL-HIDE] brand-a");
    expect(progress).toContain(
      "[NO-CHANNEL-VERDICT] reject failed after hide brand-a: P0002: submission is not pending",
    );
  });

  it("reject_error_is_isolated_per_target", async () => {
    const rejectSubmission = vi
      .fn()
      .mockRejectedValueOnce(new Error("P0002: submission is not pending"))
      .mockResolvedValueOnce({});

    const result = await applyNoPurchaseChannelVerdicts({
      jobId: "job-1",
      reportOnly: false,
      deps: deps({
        selectVerdictTargets: vi.fn(async () => [
          verdictTarget({ submissionId: "sub-1", slug: "brand-a" }),
          verdictTarget({
            targetId: "target-2",
            submissionId: "sub-2",
            slug: "brand-b",
          }),
        ]),
        rejectSubmission,
      }),
    });

    expect(result.verdictSkipped).toBe(1);
    expect(result.noChannelRejected).toBe(1);
    expect(result.targets[0]).toMatchObject({
      slug: "brand-a",
      action: "skipped",
    });
    expect(result.targets[1]).toEqual({ slug: "brand-b", action: "rejected" });
  });

  it("report_only_mode_writes_nothing", async () => {
    process.env.CHANNEL_VERDICTS = "off";
    const rejectSubmission = vi.fn(async () => ({}));
    const hideBrandWithReason = vi.fn(async () => ({
      ok: true,
      changed: true,
      slug: "brand-b",
    }));
    const requestPublicBrandRevalidation = vi.fn(async () => ({ ok: true }));
    const progress: string[] = [];

    const result = await applyNoPurchaseChannelVerdicts({
      jobId: "job-1",
      onProgress: (message) => progress.push(message),
      deps: deps({
        selectVerdictTargets: vi.fn(async () => [
          verdictTarget(),
          verdictTarget({
            targetId: "target-2",
            submissionId: "sub-2",
            slug: "brand-b",
            intent: "refresh",
            brandId: "brand-uuid",
          }),
        ]),
        rejectSubmission,
        hideBrandWithReason,
        requestPublicBrandRevalidation,
      }),
    });

    expect(rejectSubmission).not.toHaveBeenCalled();
    expect(hideBrandWithReason).not.toHaveBeenCalled();
    expect(requestPublicBrandRevalidation).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      reportOnly: true,
      noChannelRejected: 0,
      noChannelHidden: 0,
      verdictSkipped: 0,
      hideFailed: 0,
    });
    expect(result.targets).toEqual([
      { slug: "brand-a", action: "would_reject" },
      { slug: "brand-b", action: "would_hide" },
    ]);
    expect(progress).toContain("[NO-CHANNEL-VERDICT] would reject brand-a");
    expect(progress).toContain("[NO-CHANNEL-VERDICT] would hide brand-b");
  });
});

describe("reject-skipped script selection", () => {
  it("reject_skipped_script_uses_shared_selection_with_its_own_prefix", async () => {
    const select = vi.fn(async () => [
      verdictTarget({
        submissionId: "sub-9",
        brandName: "Some Store",
        intent: "recommend",
        error: `${NOT_A_BRAND_PREFIX}: multi-brand retailer`,
      }),
    ]);

    const candidates = await loadNotABrandCandidates(
      select as unknown as typeof selectVerdictTargets,
    );

    expect(select).toHaveBeenCalledWith({
      errorPrefix: NOT_A_BRAND_PREFIX,
      requireConclusive: false,
    });
    expect(candidates).toEqual([
      {
        id: "sub-9",
        brandName: "Some Store",
        intent: "recommend",
        verdict: `${NOT_A_BRAND_PREFIX}: multi-brand retailer`,
      },
    ]);
  });
});
