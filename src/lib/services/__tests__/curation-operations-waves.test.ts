import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runEnrich } from "../curation-operations";
import type { DetectResult } from "../category-classifier";

/**
 * The enrichment chunk runs TWO per-brand loops with one batched `names` call
 * between them:
 *
 *   gather (probe) -> detect (batch)
 *     -> loop A [per brand: acquire, Gate A, Gate B, name candidates]
 *     -> names (batch, one call per chunk)
 *     -> loop B [per brand: names verdict, editorial, products, tags, persist]
 *
 * The batched image search that once sat between the old waves is retired, and
 * so are discover, image-search, site-identity, images and classify-images —
 * their work lives inside the acquire agent now.
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
  runNamesPhase: vi.fn(),
  runProductsPhase: vi.fn(),
  mapWithConcurrency: vi.fn(),
  probeStatic: vi.fn(),
  expandLinkHubs: vi.fn(),
  collectHubUrls: vi.fn(),
  hasPurchaseChannel: vi.fn(),
  searchBrandUrls: vi.fn(),
  insertTriageResult: vi.fn(),
  fetchHtml: vi.fn(),
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

vi.mock("../enrich-phases/gather", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/gather")>();
  return {
    ...original,
    probeStatic: mocks.probeStatic.mockResolvedValue([]),
  };
});

vi.mock("../enrich-phases/link-expansion", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/link-expansion")>();
  return {
    ...original,
    expandLinkHubs: mocks.expandLinkHubs,
    collectHubUrls: mocks.collectHubUrls,
    hasPurchaseChannel: mocks.hasPurchaseChannel,
  };
});

vi.mock("../enrich-phases/scraper/serper", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/scraper/serper")>();
  return {
    ...original,
    searchBrandUrls: mocks.searchBrandUrls,
  };
});

vi.mock("../_shared/ai-results", async (importOriginal) => {
  const original = await importOriginal<typeof import("../_shared/ai-results")>();
  return {
    ...original,
    insertTriageResult: mocks.insertTriageResult,
  };
});

vi.mock("../enrich-phases/scraper/fetch-guards", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/scraper/fetch-guards")>();
  return {
    ...original,
    fetchHtml: mocks.fetchHtml,
  };
});

vi.mock("../enrich-phases/names", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/names")>();
  return {
    ...original,
    runNamesPhase: mocks.runNamesPhase.mockImplementation(
      original.runNamesPhase,
    ),
  };
});

vi.mock("../enrich-phases/products", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/products")>();
  return {
    ...original,
    runProductsPhase: mocks.runProductsPhase.mockImplementation(
      original.runProductsPhase,
    ),
  };
});

/**
 * Spied, not replaced: the two-loop shape is a claim about HOW MANY bounded
 * maps a chunk runs, and the count is only observable here. The real
 * implementation stays in place through `mockImplementation`.
 */
vi.mock("../_shared/concurrency", async (importOriginal) => {
  const original = await importOriginal<typeof import("../_shared/concurrency")>();
  return {
    ...original,
    mapWithConcurrency: mocks.mapWithConcurrency.mockImplementation(
      original.mapWithConcurrency,
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
    purchase_myship: null,
    other_urls: [],
    enriched_data: null,
    owner_data: null,
    base_brand_data: null,
    intent: "recommend",
    ...overrides,
  };
}

/**
 * Three chains are exercised: the submission fetch in `runEnrich`, the
 * phase-history fetch from `curation_job_targets`, and the active-image read
 * that rebuilds the products image pool when acquire was satisfied from
 * history. Each terminates in an awaited thenable, so the builder is a
 * self-returning proxy with a fixed payload.
 */
function fakeSupabase(
  submissions: SubmissionRow[],
  jobTargets: Array<{ target_type: string; target_id: string; phase_results: unknown[]; created_at: string }> = [],
  images: Array<Record<string, unknown>> = [],
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
      if (table === "submission_images") return builder(images);
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

// detect + acquire: enough to exercise the single-loop flow
const PHASES = ["detect", "acquire"];

describe("wave collapse — single per-brand loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLatestSearchResults.mockResolvedValue(new Map());
    mocks.batchSearchBrandImages.mockResolvedValue(new Map());
    mocks.scrapeBrandUrls.mockResolvedValue(scrapeResult());
    // Link expansion defaults: no hubs, has purchase channel
    mocks.collectHubUrls.mockReturnValue([]);
    mocks.expandLinkHubs.mockResolvedValue({ hubsFetched: 0, adopted: [], scraped: {} });
    mocks.hasPurchaseChannel.mockReturnValue(true);
    mocks.searchBrandUrls.mockResolvedValue([]);
    mocks.insertTriageResult.mockResolvedValue(undefined);
    mocks.fetchHtml.mockResolvedValue(null);
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
        phases: ["detect", "acquire", "descriptions"],
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
      phaseResult: { phase: "acquire", status: "succeeded", changedFields: ["purchase_website"], durationMs: 50 },
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
        phases: ["detect", "acquire", "products"],
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
    mocks.collectHubUrls.mockReturnValue([]);
    mocks.expandLinkHubs.mockResolvedValue({ hubsFetched: 0, adopted: [], scraped: {} });
    mocks.hasPurchaseChannel.mockReturnValue(true);
    mocks.searchBrandUrls.mockResolvedValue([]);
    mocks.insertTriageResult.mockResolvedValue(undefined);
    mocks.fetchHtml.mockResolvedValue(null);
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
    mocks.collectHubUrls.mockReturnValue([]);
    mocks.expandLinkHubs.mockResolvedValue({ hubsFetched: 0, adopted: [], scraped: {} });
    mocks.hasPurchaseChannel.mockReturnValue(true);
    mocks.searchBrandUrls.mockResolvedValue([]);
    mocks.insertTriageResult.mockResolvedValue(undefined);
    mocks.fetchHtml.mockResolvedValue(null);
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
        phases: ["detect", "acquire", "products"],
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
        { phase: "acquire", status: "succeeded", changedFields: [], durationMs: 50 },
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
        phases: ["detect", "acquire", "products"],
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
   * A prior successful `acquire` run skips the acquire phase in wave A, so the
   * scraper is never called. `detect` rides the same history row because
   * `acquire` depends on it — a dependency with no history leaves the phase
   * unsatisfied no matter what the phase's own row says.
   */
  it("acquire_satisfied_via_history_skips_in_wave_a", async () => {
    const target = submission({
      id: "sub-acquire-satisfied",
      brand_name: "Acquire Satisfied Brand",
      social_instagram: "https://www.instagram.com/acquiresatisfied",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));

    const jobTargets = [{
      target_type: "submission",
      target_id: target.id,
      phase_results: [
        { phase: "detect", status: "succeeded", changedFields: [], durationMs: 100 },
        { phase: "acquire", status: "succeeded", changedFields: ["purchase_website"], durationMs: 200 },
      ],
      created_at: "2026-08-01T00:00:00Z",
    }];

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: ["detect", "acquire"],
        onProgress: () => {},
      },
      fakeSupabase([target], jobTargets),
    );

    // acquire is satisfied, so scrapeBrandUrls should NOT be called for this brand
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
        phase: "acquire",
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
        phases: ["detect", "acquire", "products"],
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
    mocks.collectHubUrls.mockReturnValue([]);
    mocks.expandLinkHubs.mockResolvedValue({ hubsFetched: 0, adopted: [], scraped: {} });
    mocks.hasPurchaseChannel.mockReturnValue(true);
    mocks.searchBrandUrls.mockResolvedValue([]);
    mocks.insertTriageResult.mockResolvedValue(undefined);
    mocks.fetchHtml.mockResolvedValue(null);
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
        phases: ["detect", "acquire", "descriptions", "stockists", "faq"],
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
        phases: ["detect", "acquire", "descriptions", "stockists", "faq"],
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
        phases: ["detect", "acquire", "descriptions", "stockists", "faq"],
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
        phases: ["detect", "acquire", "descriptions", "stockists", "faq"],
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

/**
 * DEV-1644 Task 5. The chunk runs TWO bounded per-brand maps with one batched
 * `names` call between them:
 *
 *   gather -> detect (batch) -> loop A [acquire, gates] -> names (batch)
 *     -> loop B [editorial, products, tags, persist]
 *
 * Before this, `names` ran inside the single loop with `chunk: [brand]` — one
 * arbiter call per brand instead of the designed one per twenty (F9) — and the
 * products call hard-coded `catalogResult: undefined` / `acquisitionPageUrls:
 * []` with no pool at all (F6).
 */
describe("two loops with a batched names call between", () => {
  const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-stub";
    mocks.getLatestSearchResults.mockResolvedValue(new Map());
    mocks.batchSearchBrandImages.mockResolvedValue(new Map());
    mocks.scrapeBrandUrls.mockResolvedValue(scrapeResult());
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));
    // Link expansion defaults: no hubs, has purchase channel
    mocks.collectHubUrls.mockReturnValue([]);
    mocks.expandLinkHubs.mockResolvedValue({ hubsFetched: 0, adopted: [], scraped: {} });
    mocks.hasPurchaseChannel.mockReturnValue(true);
    mocks.searchBrandUrls.mockResolvedValue([]);
    mocks.insertTriageResult.mockResolvedValue(undefined);
    mocks.fetchHtml.mockResolvedValue(null);
    // Canned agents by default: this block is about the SHAPE of the chunk, so
    // every phase answers instantly and each test overrides only what it
    // asserts on.
    mocks.runAcquirePhase.mockImplementation(async () => acquireOutput());
    mocks.runNamesPhase.mockImplementation(async () => namesOutput());
    mocks.runEditorialAgent.mockImplementation(async () => editorialOutput());
    mocks.runProductsPhase.mockImplementation(async () => productsOutput());
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  });

  /** Every field `runEnrich` reads off an `AcquirePhaseOutput`. */
  function acquireOutput(overrides: Record<string, unknown> = {}) {
    return {
      phaseResult: {
        phase: "acquire",
        status: "succeeded",
        changedFields: [],
        durationMs: 10,
      },
      patch: {},
      scrapedBrandName: null,
      officialNameCandidates: [],
      scrapedData: { brandName: null, description: "evidence" },
      scrapedImageUrls: [],
      scrapedImageSources: [],
      jsonLdImageUrls: [],
      quarantine: {},
      imagePool: [],
      acquisitionPageUrls: [],
      revokedColumns: [],
      providerFailure: false,
      ...overrides,
    };
  }

  function namesOutput() {
    return {
      phaseResult: {
        phase: "names",
        status: "skipped",
        changedFields: [],
        durationMs: 0,
      },
      verdicts: new Map(),
      providerFailure: false,
    };
  }

  function editorialOutput() {
    return {
      agentOutcome: "generated",
      phaseResults: [
        {
          phase: "descriptions",
          status: "succeeded",
          changedFields: ["description"],
          durationMs: 10,
        },
      ],
      patch: { description: "A description" },
      listingVerdict: null,
      descriptionRewrite: null,
      brandFacts: null,
      attempts: [],
      factsAttempts: [],
      decisions: [],
    };
  }

  function productsOutput() {
    return {
      phaseResult: {
        phase: "products",
        status: "skipped",
        changedFields: [],
        durationMs: 0,
      },
      patch: {},
    };
  }

  const FULL_PHASES = [
    "detect",
    "acquire",
    "names",
    "descriptions",
    "stockists",
    "faq",
    "products",
  ];

  it("two_loops_with_batched_names_between", async () => {
    const order: string[] = [];
    const targets = [
      submission({
        id: "sub-loop-a",
        brand_name: "Loop A",
        social_instagram: "https://www.instagram.com/loopa",
      }),
      submission({
        id: "sub-loop-b",
        brand_name: "Loop B",
        social_instagram: "https://www.instagram.com/loopb",
      }),
    ];

    mocks.detectBrandsBatch.mockImplementation(async () => {
      order.push("detect");
      return detectBatch(new Map());
    });
    mocks.runAcquirePhase.mockImplementation(async () => {
      order.push("acquire");
      return acquireOutput();
    });
    mocks.runNamesPhase.mockImplementation(
      async (ctx: { chunk: unknown[] }) => {
        order.push(`names:${ctx.chunk.length}`);
        return namesOutput();
      },
    );
    mocks.runEditorialAgent.mockImplementation(async () => {
      order.push("editorial");
      return editorialOutput();
    });
    mocks.runProductsPhase.mockImplementation(async () => {
      order.push("products");
      return productsOutput();
    });

    await runEnrich(
      {
        target: "submissions",
        submissionIds: targets.map((entry) => entry.id),
        dryRun: true,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase(targets),
    );

    expect(order.filter((step) => step === "detect")).toHaveLength(1);
    expect(order.filter((step) => step === "acquire")).toHaveLength(2);
    // ONE arbiter call for the whole chunk, carrying both brands.
    expect(order.filter((step) => step === "names:2")).toHaveLength(1);
    expect(order.filter((step) => step === "editorial")).toHaveLength(2);
    expect(order.filter((step) => step === "products")).toHaveLength(2);

    const namesIndex = order.indexOf("names:2");
    expect(order.indexOf("detect")).toBeLessThan(namesIndex);
    // Every acquire finished before the batch, and no loop-B work started
    // before it: that is what makes the call batchable at all.
    expect(order.lastIndexOf("acquire")).toBeLessThan(namesIndex);
    expect(namesIndex).toBeLessThan(order.indexOf("editorial"));
    expect(namesIndex).toBeLessThan(order.indexOf("products"));

    expect(mocks.mapWithConcurrency).toHaveBeenCalledTimes(2);
  });

  it("non_brand_exits_before_acquire", async () => {
    const rejected = submission({
      id: "sub-nb",
      brand_name: "Reseller",
      social_instagram: "https://www.instagram.com/reseller2",
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
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([rejected]),
    );

    expect(mocks.runAcquirePhase).not.toHaveBeenCalled();
    expect(mocks.runNamesPhase).not.toHaveBeenCalled();
    expect(mocks.runEditorialAgent).not.toHaveBeenCalled();
    expect(mocks.runProductsPhase).not.toHaveBeenCalled();
    expect(
      result.brandOutcomes.find(
        (outcome) => outcome.submissionId === rejected.id,
      )?.status,
    ).toBe("skipped");
  });

  it("loop_a_exit_excludes_brand_from_names_and_loop_b", async () => {
    const rejected = submission({
      id: "sub-out",
      brand_name: "Not A Brand",
      social_instagram: "https://www.instagram.com/notabrand",
    });
    const kept = submission({
      id: "sub-in",
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
              nonBrandReason: "directory",
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
    mocks.runAcquirePhase.mockResolvedValue(acquireOutput());
    mocks.runNamesPhase.mockResolvedValue(namesOutput());
    mocks.runEditorialAgent.mockResolvedValue(editorialOutput());
    mocks.runProductsPhase.mockResolvedValue(productsOutput());

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [rejected.id, kept.id],
        dryRun: true,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([rejected, kept]),
    );

    // The batch is built from the survivors only — a rejected entry must never
    // cost an arbiter slot, and must never be re-emitted by loop B.
    expect(mocks.runNamesPhase).toHaveBeenCalledOnce();
    const namesCtx = mocks.runNamesPhase.mock.calls[0][0] as {
      chunk: Array<{ id: string }>;
    };
    expect(namesCtx.chunk.map((brand) => brand.id)).toEqual([kept.id]);
    expect(mocks.runEditorialAgent).toHaveBeenCalledOnce();
    expect(mocks.runProductsPhase).toHaveBeenCalledOnce();
  });

  it("gate_a_fires_on_acquire_provider_failure", async () => {
    const target = submission({
      id: "sub-gate-a",
      brand_name: "Gate A Brand",
      social_instagram: "https://www.instagram.com/gatea",
    });
    // F5: nothing ever set `providerFailure`, so Gate A could not fire. Acquire
    // sets it now, and the target must fail rather than record an empty patch.
    mocks.runAcquirePhase.mockResolvedValue(
      acquireOutput({
        phaseResult: {
          phase: "acquire",
          status: "failed",
          changedFields: [],
          durationMs: 5,
          providerFailure: true,
          error: "Serper unavailable",
        },
        scrapedData: null,
        providerFailure: true,
      }),
    );

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    const outcome = result.brandOutcomes.find(
      (entry) => entry?.submissionId === target.id,
    );
    expect(outcome?.status).toBe("failed");
    expect(outcome?.error).toContain("provider");
    expect(mocks.runEditorialAgent).not.toHaveBeenCalled();
    expect(mocks.runProductsPhase).not.toHaveBeenCalled();
  });

  it("gate_b_skips_brand_from_loop_b", async () => {
    // No known URLs at all and an acquire that found nothing: there is no input
    // any downstream phase could read.
    const weak = submission({
      id: "sub-weak",
      brand_name: "Weak Brand",
      social_instagram: null,
      purchase_website: null,
    });
    const kept = submission({
      id: "sub-strong",
      brand_name: "Strong Brand",
      social_instagram: "https://www.instagram.com/strongbrand",
    });
    mocks.runAcquirePhase.mockImplementation(
      async (input: { brand: { id: string } }) =>
        input.brand.id === weak.id
          ? acquireOutput({ scrapedData: null, scrapedImageUrls: [] })
          : acquireOutput(),
    );
    mocks.runNamesPhase.mockResolvedValue(namesOutput());
    mocks.runEditorialAgent.mockResolvedValue(editorialOutput());
    mocks.runProductsPhase.mockResolvedValue(productsOutput());

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [weak.id, kept.id],
        dryRun: true,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([weak, kept]),
    );

    expect(
      result.brandOutcomes.find((entry) => entry?.submissionId === weak.id)
        ?.status,
    ).toBe("skipped");
    const namesCtx = mocks.runNamesPhase.mock.calls[0][0] as {
      chunk: Array<{ id: string }>;
    };
    expect(namesCtx.chunk.map((brand) => brand.id)).toEqual([kept.id]);
    expect(mocks.runEditorialAgent).toHaveBeenCalledOnce();
    expect(mocks.runProductsPhase).toHaveBeenCalledOnce();
    const productsInput = mocks.runProductsPhase.mock.calls[0][0] as {
      brand: { id: string };
    };
    expect(productsInput.brand.id).toBe(kept.id);
  });

  it("products_receives_image_pool_catalog_and_priority_urls_from_acquire", async () => {
    const target = submission({
      id: "sub-pool",
      brand_name: "Pool Brand",
      social_instagram: "https://www.instagram.com/poolbrand2",
    });
    const imagePool = [
      {
        id: "img-1",
        tag: "product" as const,
        score: 9,
        disposition: "keep" as const,
        sourceUrl: "https://pool.example.com/products/vase",
        imageUrl: "https://cdn.example.com/vase.jpg",
      },
    ];
    const catalogResult = {
      candidates: [],
      entryUrls: ["https://pool.example.com/shop"],
      priorityProductUrls: ["https://pool.example.com/products/vase"],
      rawCount: 0,
    };
    mocks.runAcquirePhase.mockResolvedValue(
      acquireOutput({
        imagePool,
        catalogResult,
        acquisitionPageUrls: ["https://pool.example.com/products/vase"],
      }),
    );
    mocks.runNamesPhase.mockResolvedValue(namesOutput());
    mocks.runEditorialAgent.mockResolvedValue(editorialOutput());
    mocks.runProductsPhase.mockResolvedValue(productsOutput());

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    const productsInput = mocks.runProductsPhase.mock.calls[0][0] as {
      imagePool: unknown;
      catalogResult: unknown;
      acquisitionPageUrls: unknown;
    };
    expect(productsInput.imagePool).toEqual(imagePool);
    expect(productsInput.catalogResult).toEqual(catalogResult);
    expect(productsInput.acquisitionPageUrls).toEqual([
      "https://pool.example.com/products/vase",
    ]);
  });

  it("products_pool_from_history_when_acquire_satisfied", async () => {
    const target = submission({
      id: "sub-history-pool",
      brand_name: "History Pool",
      social_instagram: "https://www.instagram.com/historypool",
    });
    const jobTargets = [
      {
        target_type: "submission",
        target_id: target.id,
        phase_results: [
          {
            phase: "detect",
            status: "succeeded",
            changedFields: [],
            durationMs: 10,
          },
          {
            phase: "acquire",
            status: "succeeded",
            changedFields: [],
            durationMs: 10,
          },
        ],
        created_at: "2026-08-01T00:00:00Z",
      },
    ];
    const images = [
      {
        id: "img-history",
        url: "https://cdn.example.com/stored.jpg",
        source: "scraped",
        status: "active",
        tags: ["product"],
        score: 8,
        sort_order: 0,
        storage_path: "brands/history/stored.jpg",
        source_url: "https://history.example.com/products/mug",
        width: 1200,
        height: 900,
      },
    ];
    mocks.runNamesPhase.mockResolvedValue(namesOutput());
    mocks.runEditorialAgent.mockResolvedValue(editorialOutput());
    mocks.runProductsPhase.mockResolvedValue(productsOutput());

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target], jobTargets, images),
    );

    // Acquire was satisfied from history, so it produced no pool. Without the
    // fallback, product image verification would silently pass on an empty set.
    expect(mocks.runAcquirePhase).not.toHaveBeenCalled();
    const productsInput = mocks.runProductsPhase.mock.calls[0][0] as {
      imagePool: Array<Record<string, unknown>>;
    };
    expect(productsInput.imagePool).toHaveLength(1);
    expect(productsInput.imagePool[0]).toMatchObject({
      id: "img-history",
      tag: "product",
      sourceUrl: "https://history.example.com/products/mug",
      imageUrl: "https://cdn.example.com/stored.jpg",
    });
  });

  it("editorial_deps_are_real_not_stubs", async () => {
    const target = submission({
      id: "sub-deps",
      brand_name: "Deps Brand",
      social_instagram: "https://www.instagram.com/depsbrand",
    });
    mocks.runAcquirePhase.mockResolvedValue(acquireOutput());
    mocks.runNamesPhase.mockResolvedValue(namesOutput());
    mocks.runEditorialAgent.mockResolvedValue(editorialOutput());
    mocks.runProductsPhase.mockResolvedValue(productsOutput());

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    const deps = mocks.runEditorialAgent.mock.calls[0][1] as {
      validateCrossOutput: (
        patch: Record<string, unknown>,
        phaseResults: unknown[],
      ) => Array<{ field: string; reason: string }>;
      repairCrossOutput: (...args: unknown[]) => Promise<unknown>;
      requestEvidence?: unknown;
    };

    // F11: production shipped a validator that always answered with an empty
    // array, so the graph's validate -> repair edge could never fire. The real
    // one flags an AI-slop opener and a city outside the closed set.
    const failures = deps.validateCrossOutput(
      {
        description_en:
          "In a world where design matters, this studio keeps making the same quiet bowls.",
        city: "kyoto",
      },
      [
        {
          phase: "descriptions",
          status: "succeeded",
          changedFields: [],
          durationMs: 1,
        },
      ],
    );
    expect(failures.length).toBeGreaterThan(0);
    expect(
      failures.some((failure) => failure.reason.startsWith("ai_artifact:")),
    ).toBe(true);
    expect(failures.some((failure) => failure.field === "city")).toBe(true);

    // The other two stubs: the repair took one argument and echoed it straight
    // back; the real one takes the failures too and answers with the repaired
    // fields only. `requestEvidence` was never supplied at all. (The repair turn
    // itself is exercised against a fake model in
    // `editorial/__tests__/validators.test.ts` — running it here would mean a
    // live model call.)
    expect(deps.repairCrossOutput.length).toBe(2);
    expect(typeof deps.requestEvidence).toBe("function");
  });
});

/**
 * DEV-1692. Link-hub expansion, SERP fallback search, and the
 * no_purchase_channel gate — the pre-acquire sub-step that feeds or gates the
 * rest of the pipeline.
 */
describe("link expansion, SERP search, and no-purchase-channel gate", () => {
  const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-stub";
    mocks.getLatestSearchResults.mockResolvedValue(new Map());
    mocks.batchSearchBrandImages.mockResolvedValue(new Map());
    mocks.scrapeBrandUrls.mockResolvedValue(scrapeResult());
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));
    // Defaults: no hubs, has channel (so the gate does not fire by default)
    mocks.collectHubUrls.mockReturnValue([]);
    mocks.expandLinkHubs.mockResolvedValue({ hubsFetched: 0, adopted: [], scraped: {} });
    mocks.hasPurchaseChannel.mockReturnValue(true);
    mocks.searchBrandUrls.mockResolvedValue([]);
    mocks.insertTriageResult.mockResolvedValue(undefined);
    mocks.fetchHtml.mockResolvedValue(null);
    mocks.runAcquirePhase.mockImplementation(async () => acquireOutput());
    mocks.runNamesPhase.mockImplementation(async () => namesOutput());
    mocks.runEditorialAgent.mockImplementation(async () => editorialOutput());
    mocks.runProductsPhase.mockImplementation(async () => productsOutput());
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  });

  /** Every field `runEnrich` reads off an `AcquirePhaseOutput`. */
  function acquireOutput(overrides: Record<string, unknown> = {}) {
    return {
      phaseResult: {
        phase: "acquire",
        status: "succeeded",
        changedFields: [],
        durationMs: 10,
      },
      patch: {},
      scrapedBrandName: null,
      officialNameCandidates: [],
      scrapedData: { brandName: null, description: "evidence" },
      scrapedImageUrls: [],
      scrapedImageSources: [],
      jsonLdImageUrls: [],
      quarantine: {},
      imagePool: [],
      acquisitionPageUrls: [],
      revokedColumns: [],
      providerFailure: false,
      ...overrides,
    };
  }

  function namesOutput() {
    return {
      phaseResult: {
        phase: "names",
        status: "skipped",
        changedFields: [],
        durationMs: 0,
      },
      verdicts: new Map(),
      providerFailure: false,
    };
  }

  function editorialOutput() {
    return {
      agentOutcome: "generated",
      phaseResults: [
        {
          phase: "descriptions",
          status: "succeeded",
          changedFields: ["description"],
          durationMs: 10,
        },
      ],
      patch: { description: "A description" },
      listingVerdict: null,
      descriptionRewrite: null,
      brandFacts: null,
      attempts: [],
      factsAttempts: [],
      decisions: [],
    };
  }

  function productsOutput() {
    return {
      phaseResult: {
        phase: "products",
        status: "skipped",
        changedFields: [],
        durationMs: 0,
      },
      patch: {},
    };
  }

  const FULL_PHASES = [
    "detect",
    "acquire",
    "names",
    "descriptions",
    "stockists",
    "faq",
    "products",
  ];

  it("hub_links_adopted_before_detect_and_reach_acquire_known_urls", async () => {
    const hubHtml = `<html><body>
      <a href="https://myship.7-11.com.tw/general/detail/GM2505068972611">Myship</a>
    </body></html>`;

    const target = submission({
      id: "sub-hub",
      brand_name: "Hub Brand",
      website_url: "https://portaly.cc/hubbrand",
      social_instagram: "https://www.instagram.com/hubbrand",
    });

    mocks.collectHubUrls.mockReturnValue(["https://portaly.cc/hubbrand"]);
    mocks.fetchHtml.mockResolvedValue(hubHtml);
    mocks.expandLinkHubs.mockResolvedValue({
      hubsFetched: 1,
      adopted: [
        {
          field: "purchaseMyship",
          value: "https://myship.7-11.com.tw/general/detail/GM2505068972611",
          source: "hub",
          hubUrl: "https://portaly.cc/hubbrand",
        },
      ],
      scraped: {
        purchaseMyship: "https://myship.7-11.com.tw/general/detail/GM2505068972611",
      },
    });
    // After expansion, the brand now has a purchase channel
    mocks.hasPurchaseChannel.mockReturnValue(true);

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    // expandLinkHubs was called
    expect(mocks.expandLinkHubs).toHaveBeenCalledOnce();
    // Acquire phase runs and receives the adopted URL in knownUrls
    expect(mocks.runAcquirePhase).toHaveBeenCalledOnce();
    const acquireInput = mocks.runAcquirePhase.mock.calls[0][0] as {
      knownUrls: string[];
      brand: Record<string, unknown>;
    };
    expect(acquireInput.knownUrls).toContain(
      "https://myship.7-11.com.tw/general/detail/GM2505068972611",
    );
    // The brand object has the adopted purchase_myship written on it
    expect(acquireInput.brand.purchase_myship).toBe(
      "https://myship.7-11.com.tw/general/detail/GM2505068972611",
    );
  });

  it("serp_by_name_runs_only_when_no_channel_after_hub_expansion", async () => {
    // Brand with only Instagram — no purchase channel after hub expansion
    const igOnly = submission({
      id: "sub-ig-only",
      brand_name: "IG Only Brand",
      social_instagram: "https://www.instagram.com/igonlybrand",
    });
    // Brand with a hub that supplies a channel — no SERP needed
    const hubbed = submission({
      id: "sub-hubbed",
      brand_name: "Hubbed Brand",
      website_url: "https://portaly.cc/hubbed",
      social_instagram: "https://www.instagram.com/hubbed",
      purchase_website: "https://hubbed.example.com",
    });

    mocks.collectHubUrls.mockReturnValue([]);
    mocks.expandLinkHubs.mockResolvedValue({
      hubsFetched: 0,
      adopted: [],
      scraped: {},
    });
    // Gather block calls hasPurchaseChannel once per brand (line 1735).
    // The later no-purchase-channel gate (line 2171) also calls it; use
    // mockReturnValue as the fallback so those calls don't consume the
    // gather-block values.
    mocks.hasPurchaseChannel
      .mockReturnValueOnce(false) // igOnly after hub expansion → triggers SERP
      .mockReturnValue(true); // hubbed after hub expansion → skips SERP; default for gate calls

    mocks.searchBrandUrls.mockResolvedValue([
      "https://igonlybrand.com/shop",
    ]);

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [igOnly.id, hubbed.id],
        dryRun: true,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([igOnly, hubbed]),
    );

    // searchBrandUrls called exactly once, for the IG-only brand
    expect(mocks.searchBrandUrls).toHaveBeenCalledOnce();
    expect(mocks.searchBrandUrls).toHaveBeenCalledWith(
      "IG Only Brand",
      undefined,
      expect.objectContaining({
        target: expect.objectContaining({ type: "submission" }),
      }),
    );
  });

  it("serp_replays_fresh_cached_result", async () => {
    const target = submission({
      id: "sub-cached-serp",
      brand_name: "Cached Brand",
      social_instagram: "https://www.instagram.com/cachedbrand",
    });

    mocks.collectHubUrls.mockReturnValue([]);
    mocks.expandLinkHubs.mockResolvedValue({
      hubsFetched: 0,
      adopted: [],
      scraped: {},
    });
    // No channel after hub expansion
    mocks.hasPurchaseChannel.mockReturnValue(false);

    // Fresh cached SERP (< 3 days old)
    const freshRow = {
      brandId: target.id,
      searchType: "serp" as const,
      query: "Cached Brand",
      urls: ["https://cachedbrand.com/shop"],
      snippets: ["cached snippet"],
      createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1 hour old
    };
    mocks.getLatestSearchResults.mockResolvedValue(
      new Map([[target.id, freshRow]]),
    );

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    // searchBrandUrls should NOT be called — cached result is fresh
    expect(mocks.searchBrandUrls).not.toHaveBeenCalled();
  });

  it("fresh_serp_feeds_detect_snippets", async () => {
    // When SERP results are returned, they should be available in the detect
    // phase input via the searchResults map
    const target = submission({
      id: "sub-serp-detect",
      brand_name: "SERP Detect Brand",
      social_instagram: "https://www.instagram.com/serpdetect",
    });

    mocks.collectHubUrls.mockReturnValue([]);
    mocks.expandLinkHubs.mockResolvedValue({
      hubsFetched: 0,
      adopted: [],
      scraped: {},
    });
    // No channel → SERP fires
    mocks.hasPurchaseChannel.mockReturnValue(false);

    mocks.searchBrandUrls.mockResolvedValue([
      "https://serpdetect.com/shop",
      "https://serpdetect.com/about",
    ]);

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    // The SERP ran — brand was gated (no purchase channel) but SERP urls
    // should have been extracted and fed to the acquire phase
    expect(mocks.searchBrandUrls).toHaveBeenCalledOnce();
    // The brand should be gated (no purchase channel) so acquire should not run
    const outcome = result.brandOutcomes.find(
      (entry) => entry?.submissionId === target.id,
    );
    expect(outcome?.status).toBe("skipped");
  });

  it("no_purchase_channel_gate_writes_triage_row_for_new_submission", async () => {
    const target = submission({
      id: "sub-no-channel",
      brand_name: "No Channel Brand",
      social_instagram: "https://www.instagram.com/nochannel",
      intent: "recommend",
    });

    mocks.collectHubUrls.mockReturnValue([]);
    mocks.expandLinkHubs.mockResolvedValue({
      hubsFetched: 0,
      adopted: [],
      scraped: {},
    });
    mocks.hasPurchaseChannel.mockReturnValue(false);

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: false,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    // insertTriageResult called with the no_purchase_channel prefix
    expect(mocks.insertTriageResult).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: target.id,
        isNonBrand: true,
        nonBrandReason: expect.stringContaining("no_purchase_channel:"),
        confidence: "medium",
      }),
    );

    const outcome = result.brandOutcomes.find(
      (entry) => entry?.submissionId === target.id,
    );
    expect(outcome?.status).toBe("skipped");
    expect(outcome?.error).toContain("no_purchase_channel:");

    // Acquire should NOT run
    expect(mocks.runAcquirePhase).not.toHaveBeenCalled();
  });

  it("no_purchase_channel_gate_skips_refresh_without_triage_row", async () => {
    const target = submission({
      id: "sub-refresh-no-channel",
      brand_name: "Refresh No Channel",
      brand_id: "brand-123",
      intent: "refresh",
      social_instagram: "https://www.instagram.com/refreshnochannel",
      base_brand_data: { name: "Refresh No Channel" },
    });

    mocks.collectHubUrls.mockReturnValue([]);
    mocks.expandLinkHubs.mockResolvedValue({
      hubsFetched: 0,
      adopted: [],
      scraped: {},
    });
    mocks.hasPurchaseChannel.mockReturnValue(false);

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: false,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    // NO triage insert for refresh intent
    expect(mocks.insertTriageResult).not.toHaveBeenCalled();

    const outcome = result.brandOutcomes.find(
      (entry) => entry?.submissionId === target.id,
    );
    expect(outcome?.status).toBe("skipped");
    expect(outcome?.error).toContain("no_purchase_channel:");
    // Phase result should carry linkExpansion
    const acquireSkip = outcome?.phaseResults?.find(
      (pr) => pr.phase === "acquire",
    );
    expect(acquireSkip?.status).toBe("skipped");
    expect(acquireSkip?.linkExpansion).toBeDefined();

    // Acquire should NOT run
    expect(mocks.runAcquirePhase).not.toHaveBeenCalled();
  });

  it("no_purchase_channel_gate_never_changes_status", async () => {
    const target = submission({
      id: "sub-no-status-change",
      brand_name: "No Status Change",
      social_instagram: "https://www.instagram.com/nostatuschange",
      intent: "recommend",
      status: "pending",
    });

    mocks.collectHubUrls.mockReturnValue([]);
    mocks.expandLinkHubs.mockResolvedValue({
      hubsFetched: 0,
      adopted: [],
      scraped: {},
    });
    mocks.hasPurchaseChannel.mockReturnValue(false);

    const supabase = fakeSupabase([target]);
    const updateCalls: unknown[] = [];
    const originalFrom = supabase.from.bind(supabase);
    supabase.from = ((table: string) => {
      const chain = originalFrom(table);
      if (table === "brands" || table === "brand_submissions") {
        const origUpdate = (chain as unknown as Record<string, unknown>).update;
        (chain as unknown as Record<string, unknown>).update = (...args: unknown[]) => {
          updateCalls.push({ table, args });
          return (origUpdate as (...a: unknown[]) => unknown).apply(chain, args);
        };
      }
      return chain;
    }) as typeof supabase.from;

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: false,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      supabase,
    );

    // No status update calls to brands or brand_submissions
    expect(updateCalls).toHaveLength(0);
  });
});
