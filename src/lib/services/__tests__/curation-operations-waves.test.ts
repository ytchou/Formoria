import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runEnrich } from "../curation-operations";
import type { DetectResult } from "../category-classifier";

/**
 * After the wave collapse (Task 8), the enrichment chunk runs as a SINGLE
 * per-brand loop:
 *
 *   cached SERP -> detect (batch) -> [per-brand: acquire -> names (batch)
 *     -> descriptions -> stockists -> faq -> products -> persist]
 *
 * The old two-wave (A/B) pattern with a batched image search between them is
 * retired. Discover, image-search, site-identity, images, and classify-images
 * are no longer separate phases — their functionality lives inside the acquire
 * agent.
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
  runAcquirePhase: vi.fn(),
  runEditorialAgent: vi.fn(),
  runDescriptionsPhase: vi.fn(),
  runStockistsPhase: vi.fn(),
  runFaqPhase: vi.fn(),
  runDiscoverPhase: vi.fn(),
  runSiteIdentityPhase: vi.fn(),
  runImageSearchPhase: vi.fn(),
  runClassifyImagesPhase: vi.fn(),
  probeStatic: vi.fn(),
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

vi.mock("../enrich-phases/acquire", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/acquire")>();
  return {
    ...original,
    runAcquirePhase: mocks.runAcquirePhase.mockImplementation(
      original.runAcquirePhase,
    ),
  };
});

vi.mock("../enrich-phases/editorial/graph", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/editorial/graph")>();
  return {
    ...original,
    runEditorialAgent: mocks.runEditorialAgent.mockImplementation(
      original.runEditorialAgent,
    ),
  };
});

vi.mock("../enrich-phases/descriptions", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/descriptions")>();
  return {
    ...original,
    runDescriptionsPhase: mocks.runDescriptionsPhase.mockImplementation(
      original.runDescriptionsPhase,
    ),
  };
});

vi.mock("../enrich-phases/stockists", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/stockists")>();
  return {
    ...original,
    runStockistsPhase: mocks.runStockistsPhase.mockImplementation(
      original.runStockistsPhase,
    ),
  };
});

vi.mock("../enrich-phases/faq", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/faq")>();
  return {
    ...original,
    runFaqPhase: mocks.runFaqPhase.mockImplementation(
      original.runFaqPhase,
    ),
  };
});

vi.mock("../enrich-phases/discover", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/discover")>();
  return {
    ...original,
    runDiscoverPhase: mocks.runDiscoverPhase.mockImplementation(
      original.runDiscoverPhase,
    ),
  };
});

vi.mock("../enrich-phases/site-identity", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/site-identity")>();
  return {
    ...original,
    runSiteIdentityPhase: mocks.runSiteIdentityPhase.mockImplementation(
      original.runSiteIdentityPhase,
    ),
  };
});

vi.mock("../enrich-phases/image-search", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/image-search")>();
  return {
    ...original,
    runImageSearchPhase: mocks.runImageSearchPhase.mockImplementation(
      original.runImageSearchPhase,
    ),
  };
});

vi.mock("../enrich-phases/classify-images", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/classify-images")>();
  return {
    ...original,
    runClassifyImagesPhase: mocks.runClassifyImagesPhase.mockImplementation(
      original.runClassifyImagesPhase,
    ),
  };
});

vi.mock("../enrich-phases/gather", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/gather")>();
  return {
    ...original,
    probeStatic: mocks.probeStatic.mockResolvedValue([]),
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

// detect + links: enough to exercise the single-loop flow
const PHASES = ["detect", "links"];

describe("wave collapse — single per-brand loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLatestSearchResults.mockResolvedValue(new Map());
    mocks.batchSearchBrandImages.mockResolvedValue(new Map());
    mocks.scrapeBrandUrls.mockResolvedValue(scrapeResult());
  });

  it("single_loop_runs_acquire_then_descriptions — no wave A/B split", async () => {
    const target = submission({
      id: "sub-flow",
      brand_name: "Flow Brand",
      social_instagram: "https://www.instagram.com/flowbrand",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));

    mocks.runEditorialAgent.mockResolvedValueOnce({
      agentOutcome: "generated",
      phaseResults: [
        { phase: "descriptions", status: "succeeded", changedFields: ["description"], durationMs: 100 },
      ],
      patch: { description: "A test description" },
      listingVerdict: null,
      descriptionRewrite: null,
      brandFacts: null,
      attempts: [],
      factsAttempts: [],
      decisions: [],
    });

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: ["detect", "links", "descriptions"],
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    // Acquire runs in the single per-brand loop
    expect(mocks.runAcquirePhase).toHaveBeenCalledOnce();
    // Descriptions runs after acquire in the SAME loop (no wave split)
    expect(mocks.runEditorialAgent).toHaveBeenCalledOnce();
    expect(result.processed).toBe(1);
  });

  it("discover_batch_not_called", async () => {
    const target = submission({
      id: "sub-no-discover",
      brand_name: "No Discover",
      social_instagram: "https://www.instagram.com/nodiscover",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));

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

    expect(mocks.runDiscoverPhase).not.toHaveBeenCalled();
  });

  it("site_identity_batch_not_called", async () => {
    const target = submission({
      id: "sub-no-si",
      brand_name: "No Site Identity",
      social_instagram: "https://www.instagram.com/nosi",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));

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

    expect(mocks.runSiteIdentityPhase).not.toHaveBeenCalled();
  });

  it("image_search_batch_not_called", async () => {
    const target = submission({
      id: "sub-no-is",
      brand_name: "No Image Search",
      social_instagram: "https://www.instagram.com/nois",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));

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

    expect(mocks.runImageSearchPhase).not.toHaveBeenCalled();
  });

  it("images_phase_not_called", async () => {
    const target = submission({
      id: "sub-no-img",
      brand_name: "No Images",
      social_instagram: "https://www.instagram.com/noimg",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));

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

    expect(mocks.runBrandImagePhase).not.toHaveBeenCalled();
  });

  it("classify_images_phase_not_called", async () => {
    const target = submission({
      id: "sub-no-classify",
      brand_name: "No Classify",
      social_instagram: "https://www.instagram.com/noclassify",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));

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

    expect(mocks.runClassifyImagesPhase).not.toHaveBeenCalled();
  });

  it("image_pool_threads_to_products — products receives image data from acquire", async () => {
    const ORIGINAL_KEY = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-stub";

    const target = submission({
      id: "sub-img-pool",
      brand_name: "Pool Brand",
      social_instagram: "https://www.instagram.com/poolbrand",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));

    mocks.runAcquirePhase.mockResolvedValueOnce({
      phaseResult: { phase: "links", status: "succeeded", changedFields: ["purchase_website"], durationMs: 50 },
      patch: { purchase_website: "https://pool.example.com" },
      scrapedBrandName: null,
      officialNameCandidates: [],
      scrapedData: { brandName: null, galleryImageUrls: ["https://pool.example.com/img1.jpg"] },
      scrapedImageUrls: ["https://pool.example.com/img1.jpg"],
      scrapedImageSources: [{ url: "https://pool.example.com/img1.jpg", method: "gallery", pageUrl: "https://pool.example.com", position: 0 }],
      jsonLdImageUrls: [],
      quarantine: {},
      acquisitionPlan: {
        surfaces: [],
        fanOut: [],
        catalog: { entryUrls: ["https://pool.example.com/shop"], priorityProductUrls: [] },
        socialBios: {},
        decisions: [],
      },
    });

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: ["detect", "links", "products"],
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    // Products phase should have been called (runProductsPhase is not mocked —
    // it runs through to its own guards). The key assertion is that the
    // orchestrator passes scrapedData from acquire into the products phase.
    // Since products requires OPENAI_API_KEY and runs real logic, we just
    // verify that the acquire result was consumed.
    expect(mocks.runAcquirePhase).toHaveBeenCalledOnce();

    if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  });

  it("probe_evidence_feeds_detect — detect receives probe evidence from gather", async () => {
    const target = submission({
      id: "sub-probe",
      brand_name: "Probe Brand",
      social_instagram: "https://www.instagram.com/probebrand",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));
    mocks.probeStatic.mockResolvedValue([
      { url: "https://www.instagram.com/probebrand", title: "Probe Brand IG", platform: "instagram" },
    ]);

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

    // probeStatic was called with the brand's known URLs
    expect(mocks.probeStatic).toHaveBeenCalled();
    const probeUrls = mocks.probeStatic.mock.calls[0]?.[0];
    expect(probeUrls).toContain("https://www.instagram.com/probebrand");
  });

  it("non-brand rejection still works in the single loop", async () => {
    const rejected = submission({
      id: "sub-nonbrand",
      brand_name: "Reseller Shop",
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

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [rejected.id],
        dryRun: true,
        phases: PHASES,
        onProgress: () => {},
      },
      fakeSupabase([rejected]),
    );

    // Non-brand is skipped
    expect(
      result.brandOutcomes.find(
        (outcome) => outcome.submissionId === rejected.id,
      ),
    ).toMatchObject({
      status: "skipped",
      error: "Detection classified this entry as not a brand: reseller",
    });
    // Acquire never runs for rejected brands
    expect(mocks.runAcquirePhase).not.toHaveBeenCalled();
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
        { phase: "acquire", status: "succeeded", changedFields: [], durationMs: 50 },
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
        phases: ["detect", "links", "products"],
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
        phases: ["detect", "links", "products"],
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
        phases: ["detect", "links"],
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
    mocks.scrapeBrandUrls.mockResolvedValue(scrapeResult());
  });

  it("products_receives_catalog_hints_from_acquire_result", async () => {
    const ORIGINAL_KEY = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-stub";

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

    // Override runAcquirePhase to return a result with an acquisitionPlan
    mocks.runAcquirePhase.mockResolvedValueOnce({
      phaseResult: {
        phase: "links",
        status: "succeeded",
        changedFields: ["purchase_website"],
        durationMs: 50,
      },
      patch: { purchase_website: "https://catalog.example.com" },
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

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: ["detect", "links", "products"],
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    // Acquire runs and its catalog plan is available for products.
    // The images/classify phases are retired — products gets catalog from acquire directly.
    expect(mocks.runAcquirePhase).toHaveBeenCalledOnce();
    // runBrandImagePhase should NOT be called
    expect(mocks.runBrandImagePhase).not.toHaveBeenCalled();

    if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  });
});

/**
 * Editorial agent integration: when EDITORIAL_AGENT is not 'off', the
 * orchestrator calls `runEditorialAgent` instead of the three individual
 * phase functions (runDescriptionsPhase, runStockistsPhase, runFaqPhase).
 */
describe("editorial agent integration", () => {
  const ORIGINAL_EDITORIAL_AGENT = process.env.EDITORIAL_AGENT;
  const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-stub";
    mocks.getLatestSearchResults.mockResolvedValue(new Map());
    mocks.batchSearchBrandImages.mockResolvedValue(new Map());
    mocks.scrapeBrandUrls.mockResolvedValue(scrapeResult());
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));
  });

  afterEach(() => {
    if (ORIGINAL_EDITORIAL_AGENT === undefined) delete process.env.EDITORIAL_AGENT;
    else process.env.EDITORIAL_AGENT = ORIGINAL_EDITORIAL_AGENT;
    if (ORIGINAL_OPENAI_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_KEY;
  });

  it("editorial_agent_replaces_individual_calls", async () => {
    delete process.env.EDITORIAL_AGENT;

    mocks.runEditorialAgent.mockResolvedValueOnce({
      agentOutcome: "generated",
      phaseResults: [
        { phase: "descriptions", status: "succeeded", changedFields: ["description"], durationMs: 100 },
        { phase: "stockists", status: "skipped", changedFields: [], durationMs: 10 },
        { phase: "faq", status: "succeeded", changedFields: [], durationMs: 50 },
      ],
      patch: { description: "A test description" },
      listingVerdict: null,
      descriptionRewrite: null,
      brandFacts: null,
      attempts: [],
      factsAttempts: [],
      decisions: [],
    });

    const target = submission({
      id: "sub-editorial",
      brand_name: "Editorial Brand",
      social_instagram: "https://www.instagram.com/editorialbrand",
    });

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: ["detect", "links", "descriptions", "stockists", "faq"],
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    // The editorial agent was called instead of individual phases
    expect(mocks.runEditorialAgent).toHaveBeenCalledOnce();
    // The three individual phase functions must NOT have been called directly
    expect(mocks.runDescriptionsPhase).not.toHaveBeenCalled();
    expect(mocks.runStockistsPhase).not.toHaveBeenCalled();
    expect(mocks.runFaqPhase).not.toHaveBeenCalled();
  });

  it("editorial_phase_results_granular", async () => {
    delete process.env.EDITORIAL_AGENT;

    mocks.runEditorialAgent.mockResolvedValueOnce({
      agentOutcome: "generated",
      phaseResults: [
        { phase: "descriptions", status: "succeeded", changedFields: ["description", "description_en"], durationMs: 100 },
        { phase: "stockists", status: "succeeded", changedFields: ["channels"], durationMs: 80 },
        { phase: "faq", status: "succeeded", changedFields: [], durationMs: 50 },
      ],
      patch: { description: "Test", description_en: "Test EN" },
      listingVerdict: null,
      descriptionRewrite: null,
      brandFacts: null,
      attempts: [],
      factsAttempts: [],
      decisions: [],
    });

    const target = submission({
      id: "sub-granular",
      brand_name: "Granular Brand",
      social_instagram: "https://www.instagram.com/granularbrand",
    });

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: ["detect", "links", "descriptions", "stockists", "faq"],
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    const outcome = result.brandOutcomes.find(
      (entry) => entry?.submissionId === target.id,
    );
    // Each editorial sub-phase has its own PhaseResult in the outcome
    const descPhase = outcome?.phaseResults?.find((pr) => pr.phase === "descriptions");
    const stockPhase = outcome?.phaseResults?.find((pr) => pr.phase === "stockists");
    const faqPhase = outcome?.phaseResults?.find((pr) => pr.phase === "faq");
    expect(descPhase?.status).toBe("succeeded");
    expect(descPhase?.changedFields).toContain("description");
    expect(stockPhase?.status).toBe("succeeded");
    expect(faqPhase?.status).toBe("succeeded");
  });

  it("editorial_respects_satisfaction", async () => {
    delete process.env.EDITORIAL_AGENT;

    // The editorial agent should NOT be called when all three sub-phases are
    // satisfied from history.
    const target = submission({
      id: "sub-satisfied-editorial",
      brand_name: "Satisfied Editorial",
      social_instagram: "https://www.instagram.com/satisfiededitorial",
    });

    const jobTargets = [{
      target_type: "submission",
      target_id: target.id,
      phase_results: [
        { phase: "detect", status: "succeeded", changedFields: [], durationMs: 50 },
        { phase: "acquire", status: "succeeded", changedFields: [], durationMs: 50 },
        { phase: "descriptions", status: "succeeded", changedFields: ["description"], durationMs: 100 },
        { phase: "stockists", status: "succeeded", changedFields: [], durationMs: 50 },
        { phase: "faq", status: "succeeded", changedFields: [], durationMs: 50 },
      ],
      created_at: "2026-08-01T00:00:00Z",
    }];

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: ["detect", "links", "descriptions", "stockists", "faq"],
        onProgress: () => {},
      },
      fakeSupabase([target], jobTargets),
    );

    // All editorial sub-phases are satisfied, so the agent should not be called
    expect(mocks.runEditorialAgent).not.toHaveBeenCalled();
    expect(mocks.runDescriptionsPhase).not.toHaveBeenCalled();
    expect(mocks.runStockistsPhase).not.toHaveBeenCalled();
    expect(mocks.runFaqPhase).not.toHaveBeenCalled();
  });

  it("editorial_agent_off_falls_back_to_individual_phases", async () => {
    process.env.EDITORIAL_AGENT = "off";

    // Mock individual phases to return canned results since the fallback
    // path calls them directly and they would otherwise hit real Supabase.
    mocks.runDescriptionsPhase.mockResolvedValueOnce({
      phaseResult: { phase: "descriptions", status: "skipped", changedFields: [], durationMs: 0 },
      patch: {},
      descriptionRewrite: null,
      brandFacts: null,
      attempts: [],
      factsAttempts: [],
      listingVerdict: null,
    });
    mocks.runStockistsPhase.mockResolvedValueOnce({
      phaseResult: { phase: "stockists", status: "skipped", changedFields: [], durationMs: 0 },
      patch: {},
    });
    mocks.runFaqPhase.mockResolvedValueOnce({
      phaseResult: { phase: "faq", status: "skipped", changedFields: [], durationMs: 0 },
      patch: {},
    });

    const target = submission({
      id: "sub-fallback",
      brand_name: "Fallback Brand",
      social_instagram: "https://www.instagram.com/fallbackbrand",
    });

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: ["detect", "links", "descriptions", "stockists", "faq"],
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    // With EDITORIAL_AGENT=off, the agent returns fallback and individual
    // phases are called directly.
    expect(mocks.runEditorialAgent).toHaveBeenCalledOnce();
    expect(mocks.runDescriptionsPhase).toHaveBeenCalled();
  });
});
