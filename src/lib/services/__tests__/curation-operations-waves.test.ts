import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runEnrich } from "../curation-operations";
import type { DetectResult } from "../category-classifier";
import type { ImageQueryInput } from "../enrich-phases/scraper/types";

/**
 * The enrichment chunk runs as two per-brand waves with ONE batched serper
 * image call between them:
 *
 *   discover -> detect -> [wave A: detect application, clean, links]
 *            -> image search (batched) -> [wave B: images ... persist]
 *
 * These tests pin the two properties that ordering buys and that no phase-level
 * test can see: a target rejected in wave A never reaches the paid image call,
 * and the image query uses the website the links phase found in the same run.
 *
 * Lives in its own file because the module mocks below would otherwise apply to
 * the DB-backed suites in `curation-operations.test.ts`.
 */

const mocks = vi.hoisted(() => ({
  detectBrandsBatch: vi.fn(),
  batchSearchBrandImages: vi.fn(),
  scrapeBrandUrls: vi.fn(),
  getLatestSearchResults: vi.fn(),
  getLangfuse: vi.fn(),
  runBrandImagePhase: vi.fn(),
  runLinksPhase: vi.fn(),
}));

vi.mock("@/lib/langfuse/client", () => ({
  getLangfuse: mocks.getLangfuse,
  flushLangfuse: vi.fn(async () => {}),
}));

vi.mock("../category-classifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../category-classifier")>()),
  detectBrandsBatch: mocks.detectBrandsBatch,
}));

vi.mock("../enrich-phases/scraper/search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../enrich-phases/scraper/search")>()),
  batchSearchBrandImages: mocks.batchSearchBrandImages,
}));

vi.mock("../enrich-phases/scraper", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../enrich-phases/scraper")>()),
  scrapeBrandUrls: mocks.scrapeBrandUrls,
}));

vi.mock("../search-results", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../search-results")>()),
  getLatestSearchResults: mocks.getLatestSearchResults,
  startSearchAudit: vi.fn(async () => "audit-1"),
  finishSearchAudit: vi.fn(async () => undefined),
}));

vi.mock("../enrich-phases/images", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/images")>();
  return {
    ...original,
    runBrandImagePhase: mocks.runBrandImagePhase.mockImplementation(
      original.runBrandImagePhase,
    ),
  };
});

vi.mock("../enrich-phases/links", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/links")>();
  return {
    ...original,
    runLinksPhase: mocks.runLinksPhase.mockImplementation(
      original.runLinksPhase,
    ),
  };
});

type SubmissionRow = {
  id: string;
  brand_name: string;
  status: string;
  brand_id: string | null;
  social_instagram: string | null;
  purchase_website: string | null;
  [key: string]: unknown;
};

function submission(
  overrides: Partial<SubmissionRow> & { id: string },
): SubmissionRow {
  return {
    brand_name: `Brand ${overrides.id}`,
    status: "pending",
    brand_id: null,
    description: null,
    website_url: null,
    hero_image_url: null,
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
    purchase_website: null,
    purchase_pinkoi: null,
    purchase_shopee: null,
    other_urls: [],
    enriched_data: null,
    owner_data: null,
    base_brand_data: null,
    intent: "recommend",
    ...overrides,
  };
}

/**
 * Only two chains are exercised: the submission fetch in `runEnrich`, the
 * phase-history fetch from `curation_job_targets`, and the active-image count
 * in the image-search phase. Both terminate in an awaited thenable, so the
 * builder is a self-returning proxy with a fixed payload.
 */
function fakeSupabase(
  submissions: SubmissionRow[],
  jobTargets: Array<{ target_type: string; target_id: string; phase_results: unknown[]; created_at: string }> = [],
): SupabaseClient {
  const builder = (rows: unknown[]): Record<string, unknown> => {
    const chain: Record<string, unknown> = {
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    };
    for (const method of [
      "select",
      "eq",
      "is",
      "in",
      "limit",
      "update",
      "single",
      "order",
    ]) {
      chain[method] = () => chain;
    }
    return chain;
  };

  return {
    from: (table: string) => {
      if (table === "brand_submissions") return builder(submissions);
      if (table === "curation_job_targets") return builder(jobTargets);
      return builder([]);
    },
  } as unknown as SupabaseClient;
}

function detectResult(
  overrides: Partial<DetectResult> & { slug: string },
): DetectResult {
  return {
    isNonBrand: false,
    nonBrandReason: null,
    brandName: null,
    slugGenerated: null,
    categorySlug: null,
    confidence: "high",
    ...overrides,
  } as DetectResult;
}

/**
 * `scrapeBrandUrls` always resolves a COMPLETE `ScrapedBrandData` in production
 * — every strategy returns a spread of `emptyResult(url)`. Mocking a partial
 * object makes the merge path throw on fields it is entitled to assume exist,
 * which is a defect in the fixture, not in the code under test.
 */
function scrapeResult(data: Record<string, unknown> = {}) {
  return {
    data: {
      brandName: null,
      description: null,
      story: null,
      heroImageUrl: null,
      websiteUrl: null,
      stockistPageText: null,
      galleryImageUrls: [],
      imageSources: [],
      jsonLdImageUrls: [],
      rawJsonLd: [],
      categoryHints: [],
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
      purchaseWebsite: null,
      purchasePinkoi: null,
      purchaseShopee: null,
      purchaseMyship: null,
      ...data,
    },
    statuses: [],
  };
}

/**
 * `detectBrandsBatch` reports call outcomes alongside its results so the phase
 * can tell a provider outage from an empty answer. A healthy batch is the
 * default here; the outage cases pass their own counts.
 */
function detectBatch(
  results: Map<string, DetectResult>,
  calls: { attempted: number; providerFailed: number } = {
    attempted: 1,
    providerFailed: 0,
  },
) {
  return { results, calls };
}

/** Every LLM call in this chunk died at the provider — the 2026-08-02 shape. */
function detectBatchProviderFailure() {
  return {
    results: new Map<string, DetectResult>(),
    calls: { attempted: 1, providerFailed: 1 },
  };
}

function imageQueryInputs(): ImageQueryInput[] {
  const call = mocks.batchSearchBrandImages.mock.calls[0];
  return (call?.[0] ?? []) as ImageQueryInput[];
}

// detect + links + images: enough to exercise both waves and the batched image
// call, without pulling any LLM description phase into the run.
const PHASES = ["detect", "links", "images"];

describe("runEnrich two-wave ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLatestSearchResults.mockResolvedValue(new Map());
    mocks.batchSearchBrandImages.mockResolvedValue(new Map());
    mocks.scrapeBrandUrls.mockResolvedValue(scrapeResult());
  });

  it("does not spend an image search on a brand wave A rejected as a non-brand", async () => {
    const rejected = submission({
      id: "sub-nonbrand",
      brand_name: "Reseller Shop",
      social_instagram: "https://www.instagram.com/reseller",
    });
    const kept = submission({
      id: "sub-brand",
      brand_name: "Real Brand",
      social_instagram: "https://www.instagram.com/realbrand",
    });
    mocks.detectBrandsBatch.mockResolvedValue(
      detectBatch(
        new Map([
          [
            `submission-${rejected.id}`,
            detectResult({
              slug: `submission-${rejected.id}`,
              isNonBrand: true,
              nonBrandReason: "reseller",
              confidence: "high",
            }),
          ],
          [
            `submission-${kept.id}`,
            detectResult({ slug: `submission-${kept.id}` }),
          ],
        ]),
      ),
    );

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [rejected.id, kept.id],
        dryRun: true,
        phases: PHASES,
        onProgress: () => {},
      },
      fakeSupabase([rejected, kept]),
    );

    // The whole point of the reorder: the paid call sees only the survivor.
    expect(mocks.batchSearchBrandImages).toHaveBeenCalledOnce();
    expect(imageQueryInputs().map((input) => input.brandName)).toEqual([
      "Real Brand",
    ]);

    // ...and the rejected target is recorded exactly once, by wave A.
    expect(result.processed).toBe(2);
    expect(result.brandOutcomes).toHaveLength(2);
    expect(result.brandOutcomes.filter(Boolean)).toHaveLength(2);
    expect(result.skipped + result.updated).toBe(2);
    expect(
      result.brandOutcomes.find(
        (outcome) => outcome.submissionId === rejected.id,
      ),
    ).toMatchObject({
      status: "skipped",
      error: "Detection classified this entry as not a brand: reseller",
    });
  });

  it("never runs the links phase for a brand wave A rejected as a non-brand", async () => {
    const rejected = submission({
      id: "sub-nonbrand",
      social_instagram: "https://www.instagram.com/reseller",
    });
    mocks.detectBrandsBatch.mockResolvedValue(
      detectBatch(
        new Map([
          [
            `submission-${rejected.id}`,
            detectResult({
              slug: `submission-${rejected.id}`,
              isNonBrand: true,
              nonBrandReason: "reseller",
              confidence: "high",
            }),
          ],
        ]),
      ),
    );

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [rejected.id],
        dryRun: true,
        phases: PHASES,
        onProgress: () => {},
      },
      fakeSupabase([rejected]),
    );

    expect(mocks.scrapeBrandUrls).not.toHaveBeenCalled();
    expect(mocks.batchSearchBrandImages).not.toHaveBeenCalled();
  });

  it("queries images with the website the links phase discovered in the same run", async () => {
    const target = submission({
      id: "sub-brand",
      brand_name: "Discovered Site Brand",
      // The only URL on the record; scraping it is how the brand's own domain
      // is learned, which used to be one enrichment run too late.
      social_instagram: "https://www.instagram.com/discoveredsite",
    });
    mocks.detectBrandsBatch.mockResolvedValue(
      detectBatch(
        new Map([
          [
            `submission-${target.id}`,
            detectResult({ slug: `submission-${target.id}` }),
          ],
        ]),
      ),
    );
    mocks.scrapeBrandUrls.mockResolvedValue(
      scrapeResult({ purchaseWebsite: "https://discovered.example.com" }),
    );

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    expect(mocks.scrapeBrandUrls).toHaveBeenCalled();
    expect(imageQueryInputs()).toEqual([
      expect.objectContaining({
        brandName: "Discovered Site Brand",
        purchaseWebsite: "https://discovered.example.com",
      }),
    ]);
  });

  it("falls back to the stored website when links discovers nothing", async () => {
    const target = submission({
      id: "sub-brand",
      brand_name: "Stored Site Brand",
      purchase_website: "https://stored.example.com",
    });
    mocks.detectBrandsBatch.mockResolvedValue(
      detectBatch(
        new Map([
          [
            `submission-${target.id}`,
            detectResult({ slug: `submission-${target.id}` }),
          ],
        ]),
      ),
    );

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    expect(imageQueryInputs()).toEqual([
      expect.objectContaining({
        purchaseWebsite: "https://stored.example.com",
      }),
    ]);
  });
});

/**
 * Gate C and the circuit breaker, exercised through the real wave-B callback.
 *
 * `detect` is used as the failing LLM phase because it is the one LLM phase the
 * `PHASES` set above already runs, so no extra module has to be mocked. The
 * behaviour under test is phase-agnostic: Gate C counts LLM phase results, and
 * detect produces one like any other.
 */
describe("Gate C and the LLM circuit breaker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLatestSearchResults.mockResolvedValue(new Map());
    mocks.batchSearchBrandImages.mockResolvedValue(new Map());
    mocks.scrapeBrandUrls.mockResolvedValue(scrapeResult());
  });

  it("fails a target whose every attempted LLM phase died at the provider", async () => {
    const target = submission({
      id: "sub-quota",
      brand_name: "Quota Blocked",
      social_instagram: "https://www.instagram.com/quotablocked",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatchProviderFailure());

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    const outcome = result.brandOutcomes.find(
      (entry) => entry?.submissionId === target.id,
    );
    // This is the whole incident in one assertion: before Gate C this target
    // was recorded `succeeded` with an empty patch and was approvable.
    expect(outcome?.status).toBe("failed");
    expect(outcome?.error).toContain("LLM provider unavailable");
    expect(
      outcome?.phaseResults?.some(
        (phaseResult) => phaseResult.providerFailure === true,
      ),
    ).toBe(true);
  });

  it("records the provider failure exactly once per target, not twice", async () => {
    // `applyDetectResult` already writes a per-brand detect entry; grafting the
    // batch failure on must replace it, not append a second `detect` row.
    const target = submission({
      id: "sub-quota",
      social_instagram: "https://www.instagram.com/quotablocked",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatchProviderFailure());

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    const detectEntries = (
      result.brandOutcomes.find((entry) => entry?.submissionId === target.id)
        ?.phaseResults ?? []
    ).filter((phaseResult) => phaseResult.phase === "detect");
    expect(detectEntries).toHaveLength(1);
  });

  it("trips the breaker after 3 consecutive provider failures and stops the run", async () => {
    const targets = Array.from({ length: 8 }, (_, index) =>
      submission({
        id: `sub-${index}`,
        brand_name: `Brand ${index}`,
        social_instagram: `https://www.instagram.com/brand${index}`,
      }),
    );
    mocks.detectBrandsBatch.mockResolvedValue(detectBatchProviderFailure());

    await expect(
      runEnrich(
        {
          target: "submissions",
          submissionIds: targets.map((entry) => entry.id),
          dryRun: true,
          phases: PHASES,
          onProgress: () => {},
        },
        fakeSupabase(targets),
      ),
    ).rejects.toThrow(/circuit breaker tripped/i);
  });

  it("leaves the un-run targets unrecorded so the job can cancel them", async () => {
    const targets = Array.from({ length: 8 }, (_, index) =>
      submission({
        id: `sub-${index}`,
        social_instagram: `https://www.instagram.com/brand${index}`,
      }),
    );
    mocks.detectBrandsBatch.mockResolvedValue(detectBatchProviderFailure());
    const outcomes: string[] = [];

    await runEnrich(
      {
        target: "submissions",
        submissionIds: targets.map((entry) => entry.id),
        dryRun: true,
        phases: PHASES,
        onProgress: () => {},
        onTargetProgress: (event) => {
          if (event.status !== "running") outcomes.push(event.targetId);
        },
      },
      fakeSupabase(targets),
    ).catch(() => undefined);

    // Concurrency 3 means the trip can overshoot by a target or two, but it
    // must never run all 8 — that is the 11.5-hour run this prevents.
    expect(outcomes.length).toBeGreaterThanOrEqual(3);
    expect(outcomes.length).toBeLessThan(targets.length);
  });

  // REGRESSION. Over-correcting Gate C to fire on any empty LLM result would
  // fail every brand the model legitimately had nothing to say about — a far
  // more common case than an outage.
  it("keeps a healthy-but-empty LLM result on the non-failed path", async () => {
    const target = submission({
      id: "sub-empty",
      brand_name: "Nothing To Say",
      social_instagram: "https://www.instagram.com/nothingtosay",
    });
    // Provider answered; it simply returned no detect verdicts.
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    const outcome = result.brandOutcomes.find(
      (entry) => entry?.submissionId === target.id,
    );
    expect(outcome?.status).not.toBe("failed");
    expect(
      outcome?.phaseResults?.some(
        (phaseResult) => phaseResult.providerFailure === true,
      ),
    ).toBe(false);
  });
});

describe("satisfaction skipping", () => {
  // Stub OPENAI_API_KEY so the env guard inside runProductsPhase never
  // masks the satisfaction skip — CI runners have no .env.local.
  const ORIGINAL_KEY = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-stub";
    mocks.getLatestSearchResults.mockResolvedValue(new Map());
    mocks.batchSearchBrandImages.mockResolvedValue(new Map());
    mocks.scrapeBrandUrls.mockResolvedValue(scrapeResult());
  });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  });

  /**
   * A submission with a prior successful `products` run in
   * `curation_job_targets` history should skip the products phase.
   */
  it("products_satisfied_via_history_skips", async () => {
    const target = submission({
      id: "sub-satisfied",
      brand_name: "Satisfied Brand",
      social_instagram: "https://www.instagram.com/satisfied",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));

    const jobTargets = [{
      target_type: "submission",
      target_id: target.id,
      phase_results: [
        { phase: "discover", status: "succeeded", changedFields: [], durationMs: 50 },
        { phase: "detect", status: "succeeded", changedFields: [], durationMs: 50 },
        { phase: "links", status: "succeeded", changedFields: [], durationMs: 50 },
        { phase: "names", status: "succeeded", changedFields: [], durationMs: 50 },
        { phase: "site_identity", status: "succeeded", changedFields: [], durationMs: 50 },
        { phase: "images", status: "succeeded", changedFields: [], durationMs: 50 },
        { phase: "classify_images", status: "succeeded", changedFields: [], durationMs: 50 },
        { phase: "products", status: "succeeded", changedFields: [], durationMs: 100 },
      ],
      created_at: "2026-08-01T00:00:00Z",
    }];

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: ["detect", "links", "images", "products"],
        onProgress: () => {},
      },
      fakeSupabase([target], jobTargets),
    );

    const outcome = result.brandOutcomes.find(
      (entry) => entry?.submissionId === target.id,
    );
    const productsPhase = outcome?.phaseResults?.find(
      (pr) => pr.phase === "products",
    );
    expect(productsPhase).toBeDefined();
    expect(productsPhase?.status).toBe("skipped");
    expect(productsPhase?.detail).toBe("phase output already satisfied");
  });

  /**
   * When force (overwrite) is set, history-based satisfaction is bypassed and
   * every phase runs regardless of prior success.
   */
  it("force_overrides_history_satisfaction", async () => {
    const target = submission({
      id: "sub-force",
      brand_name: "Force Brand",
      social_instagram: "https://www.instagram.com/forced",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));

    const jobTargets = [{
      target_type: "submission",
      target_id: target.id,
      phase_results: [
        { phase: "links", status: "succeeded", changedFields: [], durationMs: 50 },
        { phase: "site_identity", status: "succeeded", changedFields: [], durationMs: 50 },
        { phase: "products", status: "succeeded", changedFields: [], durationMs: 100 },
      ],
      created_at: "2026-08-01T00:00:00Z",
    }];

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        overwrite: true,
        phases: ["detect", "links", "images", "products"],
        onProgress: () => {},
      },
      fakeSupabase([target], jobTargets),
    );

    const outcome = result.brandOutcomes.find(
      (entry) => entry?.submissionId === target.id,
    );
    const productsPhase = outcome?.phaseResults?.find(
      (pr) => pr.phase === "products",
    );
    expect(productsPhase).toBeDefined();
    expect(productsPhase?.detail).not.toBe("phase output already satisfied");
  });

  /**
   * A prior successful `links` run skips the links phase in wave A, so the
   * scraper is never called.
   */
  it("links_satisfied_via_history_skips_in_wave_a", async () => {
    const target = submission({
      id: "sub-links-satisfied",
      brand_name: "Links Satisfied Brand",
      social_instagram: "https://www.instagram.com/linkssatisfied",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));

    const jobTargets = [{
      target_type: "submission",
      target_id: target.id,
      phase_results: [{ phase: "links", status: "succeeded", changedFields: ["purchase_website"], durationMs: 200 }],
      created_at: "2026-08-01T00:00:00Z",
    }];

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: ["detect", "links", "images"],
        onProgress: () => {},
      },
      fakeSupabase([target], jobTargets),
    );

    // links is satisfied, so scrapeBrandUrls should NOT be called for this brand
    expect(mocks.scrapeBrandUrls).not.toHaveBeenCalled();
  });
});

describe("Langfuse trace lifecycle", () => {
  it("creates a Langfuse trace when client is available", async () => {
    const mockUpdate = vi.fn();
    const mockTrace = vi.fn().mockReturnValue({ update: mockUpdate });
    mocks.getLangfuse.mockReturnValue({ trace: mockTrace });

    const target = submission({ id: "s-lf-1" });

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        slugs: ["test-brand"],
        dryRun: true,
        phases: ["detect"],
        jobId: "job-lf-1",
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    expect(mockTrace).toHaveBeenCalledOnce();
    expect(mockTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "enrich",
        metadata: expect.objectContaining({
          brandSlug: "test-brand",
          jobId: "job-lf-1",
        }),
      }),
    );
  });

  it("works without Langfuse", async () => {
    mocks.getLangfuse.mockReturnValue(null);

    const target = submission({ id: "s-lf-2" });

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: ["detect"],
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    // runEnrich completes normally
    expect(result).toBeDefined();
    expect(result.errors).toBeDefined();
  });
});

describe("acquisition plan catalog threading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLatestSearchResults.mockResolvedValue(new Map());
    mocks.batchSearchBrandImages.mockResolvedValue(new Map());
    // Re-attach the call-through for existing behavior
    mocks.scrapeBrandUrls.mockResolvedValue(scrapeResult());
  });

  it("wave_b_reads_catalog_hints_from_links_result", async () => {
    const target = submission({
      id: "sub-catalog",
      brand_name: "Catalog Brand",
      social_instagram: "https://www.instagram.com/catalogbrand",
      purchase_website: "https://catalog.example.com",
    });
    mocks.detectBrandsBatch.mockResolvedValue(
      detectBatch(
        new Map([
          [
            `submission-${target.id}`,
            detectResult({ slug: `submission-${target.id}` }),
          ],
        ]),
      ),
    );

    const catalogEntryUrls = [
      "https://catalog.example.com/collections/all",
      "https://catalog.example.com/shop",
    ];
    const catalogPriorityProductUrls = [
      "https://catalog.example.com/products/vase",
    ];

    // Override runLinksPhase to return a result with an acquisitionPlan
    mocks.runLinksPhase.mockResolvedValueOnce({
      phaseResult: {
        phase: "links",
        status: "succeeded",
        changedFields: [],
        durationMs: 50,
      },
      patch: {},
      scrapedBrandName: null,
      officialNameCandidates: [],
      scrapedData: null,
      scrapedImageUrls: [],
      scrapedImageSources: [],
      jsonLdImageUrls: [],
      quarantine: {},
      acquisitionPlan: {
        surfaces: [],
        fanOut: [],
        catalog: {
          entryUrls: catalogEntryUrls,
          priorityProductUrls: catalogPriorityProductUrls,
        },
        socialBios: {},
        decisions: [],
      },
    });

    // Override runBrandImagePhase to return a canned result (avoid real execution)
    mocks.runBrandImagePhase.mockResolvedValueOnce({
      phaseResult: {
        phase: "images",
        status: "succeeded",
        changedFields: [],
        durationMs: 10,
      },
      patch: {},
      catalogResult: { triples: [], attempts: [], evidence: new Map() },
      acquisitionPageUrls: [],
    });

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    // The orchestrator must thread the plan's catalog into runBrandImagePhase
    expect(mocks.runBrandImagePhase).toHaveBeenCalledOnce();
    const imageArgs = mocks.runBrandImagePhase.mock.calls[0]![0];
    expect(imageArgs.catalogEntryUrls).toEqual(catalogEntryUrls);
    expect(imageArgs.catalogPriorityProductUrls).toEqual(
      catalogPriorityProductUrls,
    );
  });
});
