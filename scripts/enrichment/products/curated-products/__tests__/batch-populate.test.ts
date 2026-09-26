import { describe, expect, it } from "vitest";

import {
  batchPopulate,
  type BatchPopulateDeps,
  type BatchPopulateInput,
} from "../batch-populate";

/**
 * Batch-populate CLI wrapper (DEV-1609).
 *
 * Every seam is injected — `scripts/check-test-boundaries.mjs` forbids
 * vi.mock of service and supabase modules.
 */

function makeDeps(
  overrides: Partial<BatchPopulateDeps> = {},
): {
  deps: BatchPopulateDeps;
  calls: {
    resolveBrands: string[][];
    resolveRequester: string[];
    runBackfill: Array<{
      brandIds: string[];
      requester: { id: string; email: string };
    }>;
  };
  backfillResult: { jobId: string | null; outcomes: Array<{ brandId: string; submissionId: string | null; error: string | null }> };
} {
  const calls = {
    resolveBrands: [] as string[][],
    resolveRequester: [] as string[],
    runBackfill: [] as Array<{
      brandIds: string[];
      requester: { id: string; email: string };
    }>,
  };

  const backfillResult = {
    jobId: "job-001",
    outcomes: [
      { brandId: "brand-id-a", submissionId: "sub-a", error: null },
      { brandId: "brand-id-b", submissionId: "sub-b", error: null },
    ],
  };

  const deps: BatchPopulateDeps = {
    resolveBrands: overrides.resolveBrands ?? (async (slugs) => {
      calls.resolveBrands.push(slugs);
      return slugs.map((slug) => ({
        id: `brand-id-${slug.split("-").pop()}`,
        slug,
        purchase_website: `https://${slug}.example.com`,
      }));
    }),
    resolveRequester: overrides.resolveRequester ?? (async (email) => {
      calls.resolveRequester.push(email);
      return { id: "admin-uuid", email };
    }),
    runBackfill: overrides.runBackfill ?? (async (brandIds, requester) => {
      calls.runBackfill.push({ brandIds, requester });
      return backfillResult;
    }),
  };

  return { deps, calls, backfillResult };
}

function input(overrides: Partial<BatchPopulateInput> = {}): BatchPopulateInput {
  return {
    slugs: ["brand-a", "brand-b"],
    apply: false,
    adminEmail: "admin@formoria.com",
    ...overrides,
  };
}

describe("batchPopulate", () => {
  it("resolves slugs to brand IDs and throws on missing slugs", async () => {
    const { deps, calls } = makeDeps({
      resolveBrands: async (slugs) => {
        calls.resolveBrands.push(slugs);
        // Return only one of two requested slugs
        return [{ id: "brand-id-a", slug: "brand-a", purchase_website: "https://a.example.com" }];
      },
    });

    await expect(
      batchPopulate(input({ slugs: ["brand-a", "brand-missing"] }), deps),
    ).rejects.toThrow(/unresolved.*brand-missing/i);

    expect(calls.resolveBrands).toEqual([["brand-a", "brand-missing"]]);
  });

  it("dry run does not call backfill", async () => {
    const { deps, calls } = makeDeps();

    const result = await batchPopulate(input({ apply: false }), deps);

    expect(calls.runBackfill).toEqual([]);
    expect(calls.resolveRequester).toEqual([]);
    expect(result.mode).toBe("dry-run");
    expect(result.brands).toHaveLength(2);
  });

  it("apply calls backfill with resolved IDs and requester", async () => {
    const { deps, calls } = makeDeps();

    const result = await batchPopulate(
      input({ slugs: ["brand-a", "brand-b"], apply: true }),
      deps,
    );

    expect(calls.resolveRequester).toEqual(["admin@formoria.com"]);
    expect(calls.runBackfill).toEqual([
      {
        brandIds: ["brand-id-a", "brand-id-b"],
        requester: { id: "admin-uuid", email: "admin@formoria.com" },
      },
    ]);
    expect(result.mode).toBe("apply");
    expect(result.jobId).toBe("job-001");
  });

  it("reports per-brand outcome including submission IDs and errors", async () => {
    const { deps } = makeDeps({
      runBackfill: async () => ({
        jobId: "job-002",
        outcomes: [
          { brandId: "brand-id-a", submissionId: "sub-a", error: null },
          { brandId: "brand-id-b", submissionId: null, error: "A refresh is already pending for this brand" },
        ],
      }),
    });

    const result = await batchPopulate(
      input({ slugs: ["brand-a", "brand-b"], apply: true }),
      deps,
    );

    expect(result.outcomes).toEqual([
      { brandId: "brand-id-a", submissionId: "sub-a", error: null },
      { brandId: "brand-id-b", submissionId: null, error: "A refresh is already pending for this brand" },
    ]);
    expect(result.jobId).toBe("job-002");
  });

  it("throws when a brand has no purchase_website", async () => {
    const { deps } = makeDeps({
      resolveBrands: async () => [
        { id: "brand-id-a", slug: "brand-a", purchase_website: "https://a.example.com" },
        { id: "brand-id-b", slug: "brand-b", purchase_website: null },
      ],
    });

    await expect(
      batchPopulate(input({ slugs: ["brand-a", "brand-b"], apply: true }), deps),
    ).rejects.toThrow(/purchase_website.*brand-b/i);
  });
});

// ---------------------------------------------------------------------------
// parseRewriteOption (DEV-1709)
// ---------------------------------------------------------------------------

import { parseRewriteOption } from "../shared";

describe("parseRewriteOption", () => {
  it("returns true when --rewrite-descriptions is present", () => {
    expect(parseRewriteOption(["--rewrite-descriptions"])).toBe(true);
    expect(parseRewriteOption(["--apply", "--rewrite-descriptions"])).toBe(
      true,
    );
  });

  it("returns false when --rewrite-descriptions is absent", () => {
    expect(parseRewriteOption([])).toBe(false);
    expect(parseRewriteOption(["--apply", "--slugs", "brand-a"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rewriteSummaryLines (DEV-1856)
// ---------------------------------------------------------------------------

import { rewriteSummaryLines } from "../batch-populate";

describe("rewriteSummaryLines", () => {
  const result = {
    total: 3,
    rewritten: 2,
    skipped: [],
    failed: [],
    diffs: [],
    originOmitted: [{ id: "p1", nameZh: "Walnut Chopsticks", brandSlug: "brand-a" }],
  };

  it("prints originOmitted in the apply summary", () => {
    const text = rewriteSummaryLines(result, true).join("\n");
    expect(text).toContain("Rewritten: 2/3");
    expect(text).toContain("Origin omitted: 1");
    expect(text).toContain("brand-a/Walnut Chopsticks (p1)");
  });

  it("prints originOmitted in the dry-run summary", () => {
    const text = rewriteSummaryLines(result, false).join("\n");
    expect(text).toContain("Dry-run complete. Total: 3, Would rewrite: 2");
    expect(text).toContain("Origin omitted: 1");
    expect(text).toContain("brand-a/Walnut Chopsticks (p1)");
  });

  it("prints each skipped product with its reason", () => {
    const skipped = [
      { id: "p2", nameZh: "Oak Tray", brandSlug: "brand-a", reason: "verify_failed:name_echo" },
    ];
    const text = rewriteSummaryLines({ ...result, skipped }, false).join("\n");
    expect(text).toContain("Skipped: 1");
    expect(text).toContain("skipped: brand-a/Oak Tray (p2): verify_failed:name_echo");
  });

  it("prints a zero count and no product lines when nothing is omitted", () => {
    const lines = rewriteSummaryLines({ ...result, originOmitted: [] }, true);
    expect(lines.join("\n")).toContain("Origin omitted: 0");
    expect(lines.some((l) => l.includes("(p1)"))).toBe(false);
  });
});
