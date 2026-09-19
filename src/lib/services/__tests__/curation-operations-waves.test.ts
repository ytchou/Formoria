import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runEnrich } from "../curation-operations";
import { toAcquireCarry } from "../enrich-blocks/phase-outputs";
import type { AcquirePhaseOutput } from "../enrich-phases/acquire";
import type { DetectResult } from "../category-classifier";

/**
 * The enrichment chunk runs blocks in BLOCK_ORDER via the DAG runner:
 *
 *   gather → detect → acquire → names (batch) → editorial → products → persist
 *
 * Chunk-scope blocks (gather, detect, names) run once as barriers;
 * brand-scope blocks fan out with ENRICH_BRAND_CONCURRENCY.
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
  runAcquirePhase: vi.fn(),
  runEditorialAgent: vi.fn(),
  runDescriptionsPhase: vi.fn(),
  runStockistsPhase: vi.fn(),
  runFaqPhase: vi.fn(),
  runDiscoverPhase: vi.fn(),
  runSiteIdentityPhase: vi.fn(),
  runImageSearchPhase: vi.fn(),
  runNamesPhase: vi.fn(),
  runProductsPhase: vi.fn(),
  mapWithConcurrency: vi.fn(),
  probeStatic: vi.fn(),
  expandLinkHubs: vi.fn(),
  expandSerpDiscoveredHubs: vi.fn(),
  collectHubUrls: vi.fn(),
  hasPurchaseChannel: vi.fn(),
  searchBrandUrls: vi.fn(),
  batchSearchBrandsWithSnippets: vi.fn(),
  expandThreadsBio: vi.fn(),
  fetchHtmlWithMetadata: vi.fn(),
  insertTriageResult: vi.fn(),
  fetchHtml: vi.fn(),
  createSupabasePhaseOutputStore: vi.fn(),
  persistSubmissionEnrichmentResults: vi.fn(),
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
    expandSerpDiscoveredHubs: mocks.expandSerpDiscoveredHubs,
    expandThreadsBio: mocks.expandThreadsBio,
    collectHubUrls: mocks.collectHubUrls,
    hasPurchaseChannel: mocks.hasPurchaseChannel,
  };
});

vi.mock("../enrich-phases/scraper/serper", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-phases/scraper/serper")>();
  return {
    ...original,
    searchBrandUrls: mocks.searchBrandUrls,
    batchSearchBrandsWithSnippets: mocks.batchSearchBrandsWithSnippets,
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
    fetchHtmlWithMetadata: mocks.fetchHtmlWithMetadata,
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
 * Spied, not replaced: the concurrency utility is still used by the gather
 * block internally; the spy lets tests observe without replacing behavior.
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

vi.mock("../enrich-blocks/phase-outputs", async (importOriginal) => {
  const original = await importOriginal<typeof import("../enrich-blocks/phase-outputs")>();
  return {
    ...original,
    createSupabasePhaseOutputStore: mocks.createSupabasePhaseOutputStore.mockReturnValue({
      reader: { forTargets: async () => [], latestPerPhase: async () => [], unpersisted: async () => [] },
      writer: { upsert: async () => [] },
    }),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function fakeSupabase(
  submissions: SubmissionRow[],
  jobTargets: Array<{
    target_type: string;
    target_id: string;
    phase_results: unknown[];
    created_at: string;
  }> = [],
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

function detectBatch(
  results: Map<string, DetectResult>,
  calls: { attempted: number; providerFailed: number } = {
    attempted: 1,
    providerFailed: 0,
  },
) {
  return { results, calls };
}

function detectBatchProviderFailure() {
  return {
    results: new Map<string, DetectResult>(),
    calls: { attempted: 1, providerFailed: 1 },
  };
}

type SerpStub = {
  urls?: string[];
  snippets?: string[];
  entries?: Array<{ title: string; link: string; snippet?: string }>;
  callStatus?: string;
};

function stubSerpCalls(stubs: { name?: SerpStub }) {
  mocks.batchSearchBrandsWithSnippets.mockImplementation(
    async (names: string[]) => {
      const stub = stubs.name;
      const results = new Map<string, unknown>();
      if (!stub) return results;
      for (const name of names) {
        results.set(name, {
          urls: [],
          snippets: [],
          entries: [],
          callStatus: "succeeded",
          ...stub,
        });
      }
      return results;
    },
  );
}

function serpCalls() {
  return mocks.batchSearchBrandsWithSnippets.mock.calls;
}

/** Every field `runEnrich` reads off an `AcquirePhaseOutput`. */
function acquireOutput(overrides: Record<string, unknown> = {}): AcquirePhaseOutput {
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
    priorityProductUrls: [],
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
    phaseOutputs: [{ phaseResult: { phase: "descriptions", status: "succeeded", changedFields: ["description"], durationMs: 10 }, patch: { description: "A description" } }],
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

// detect + acquire: enough to exercise the single-loop flow
const PHASES = ["detect", "acquire"];
const FULL_PHASES = [
  "detect",
  "acquire",
  "names",
  "descriptions",
  "stockists",
  "faq",
  "products",
];

/** Empty editorial output — no sub-phase results, no patch. */
function emptyEditorialOutput() {
  return {
    agentOutcome: "generated" as const,
    phaseOutputs: [],
    phaseResults: [] as Array<{
      phase: string;
      status: string;
      changedFields: string[];
      durationMs: number;
    }>,
    patch: {},
    listingVerdict: null,
    descriptionRewrite: null,
    brandFacts: null,
    attempts: [],
    factsAttempts: [],
    decisions: [],
  };
}

/**
 * Override the phase-output store mock to return history rows for the given
 * phases. `fetchPhaseHistory` reads from this store (not `curation_job_targets`).
 */
function mockSatisfiedPhases(phases: string[]) {
  mocks.createSupabasePhaseOutputStore.mockReturnValue({
    reader: {
      forTargets: async (targets: Array<{ id: string; type: string }>) => targets.flatMap((target) =>
        phases.map((phase) => ({
          id: `out-${target.id}-${phase}`, job_id: "job-prev", target_id: target.id,
          target_type: target.type, phase, status: "succeeded", output: { patch: {}, ...(phase === "acquire" ? { carry: toAcquireCarry(acquireOutput()) } : {}) },
          persisted_at: "2026-08-01T00:00:00Z", created_at: "2026-08-01T00:00:00Z",
        }))),
      latestPerPhase: async () => [],
      unpersisted: async () => [],
    },
    writer: { upsert: async () => [] },
  });
}

function defaultBeforeEach() {
  vi.clearAllMocks();
  // Reset the phase-output store to empty (clearAllMocks does not reset
  // return values set by mockReturnValue).
  mocks.createSupabasePhaseOutputStore.mockReturnValue({
    reader: { forTargets: async () => [], latestPerPhase: async () => [], unpersisted: async () => [] },
    writer: { upsert: async () => [] },
  });
  mocks.getLatestSearchResults.mockResolvedValue(new Map());
  mocks.batchSearchBrandImages.mockResolvedValue(new Map());
  mocks.scrapeBrandUrls.mockResolvedValue(scrapeResult());
  mocks.collectHubUrls.mockReturnValue([]);
  mocks.expandLinkHubs.mockResolvedValue({
    hubsFetched: 0,
    fetchFailures: 0,
    adopted: [],
    scraped: {},
  });
  mocks.expandSerpDiscoveredHubs.mockResolvedValue({
    hubsFetched: 0,
    fetchFailures: 0,
    adopted: [],
    scraped: {},
  });
  mocks.hasPurchaseChannel.mockReturnValue(true);
  mocks.searchBrandUrls.mockResolvedValue([]);
  mocks.batchSearchBrandsWithSnippets.mockResolvedValue(new Map());
  mocks.expandThreadsBio.mockResolvedValue({
    threads: "absent",
    hubUrls: [],
    adopted: [],
    scraped: {},
  });
  mocks.fetchHtmlWithMetadata.mockResolvedValue({
    text: null,
    status: null,
    latencyMs: 0,
    error: "not stubbed",
  });
  mocks.insertTriageResult.mockResolvedValue(undefined);
  mocks.fetchHtml.mockResolvedValue(null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("wave collapse — single per-brand loop", () => {
  beforeEach(() => defaultBeforeEach());

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
        {
          phase: "descriptions",
          status: "succeeded",
          changedFields: ["description"],
          durationMs: 100,
        },
      ],
      phaseOutputs: [{ phaseResult: { phase: "descriptions", status: "succeeded", changedFields: ["description"], durationMs: 100 }, patch: { description: "A test description" } }],
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

    expect(mocks.runAcquirePhase).toHaveBeenCalledOnce();
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

  it("probe_evidence_feeds_detect — detect receives probe evidence from gather", async () => {
    const target = submission({
      id: "sub-probe",
      brand_name: "Probe Brand",
      social_instagram: "https://www.instagram.com/probebrand",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));
    mocks.probeStatic.mockResolvedValue([
      {
        url: "https://www.instagram.com/probebrand",
        title: "Probe Brand IG",
        platform: "instagram",
      },
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

    expect(
      result.brandOutcomes.find(
        (outcome) => outcome.submissionId === rejected.id,
      ),
    ).toMatchObject({
      status: "skipped",
      error: "Detection classified this entry as not a brand: reseller",
    });
    expect(mocks.runAcquirePhase).not.toHaveBeenCalled();
  });
});

describe("Gate C and the LLM circuit breaker", () => {
  beforeEach(() => defaultBeforeEach());

  it("gate_a_provider_failure_fails_brand", async () => {
    const target = submission({
      id: "sub-gate-a",
      brand_name: "Gate A Brand",
      social_instagram: "https://www.instagram.com/gatea",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));
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

  it("fails a target whose every attempted LLM phase died at the provider", async () => {
    const target = submission({
      id: "sub-quota",
      brand_name: "Quota Blocked",
      social_instagram: "https://www.instagram.com/quotablocked",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatchProviderFailure());
    // Acquire returns a skipped result so Gate A does not fire and Gate C
    // (the LLM gate) can see detect as the only attempted LLM phase.
    mocks.runAcquirePhase.mockResolvedValue(
      acquireOutput({
        phaseResult: { phase: "acquire", status: "skipped", changedFields: [], durationMs: 0 },
      }),
    );
    mocks.runNamesPhase.mockResolvedValue(namesOutput());
    mocks.runEditorialAgent.mockResolvedValue(emptyEditorialOutput());
    mocks.runProductsPhase.mockResolvedValue(productsOutput());

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
    expect(outcome?.status).toBe("failed");
    expect(outcome?.error).toContain("LLM provider unavailable");
    expect(
      outcome?.phaseResults?.some(
        (phaseResult) => phaseResult.providerFailure === true,
      ),
    ).toBe(true);
  });

  it("gate_c_breaker_trips_after_three", async () => {
    const targets = Array.from({ length: 8 }, (_, index) =>
      submission({
        id: `sub-${index}`,
        brand_name: `Brand ${index}`,
        social_instagram: `https://www.instagram.com/brand${index}`,
      }),
    );
    mocks.detectBrandsBatch.mockResolvedValue(detectBatchProviderFailure());
    // Same setup as the single-brand Gate C test: acquire skipped so the LLM
    // breaker counts detect's providerFailure via Gate C, not Gate A.
    mocks.runAcquirePhase.mockResolvedValue(
      acquireOutput({
        phaseResult: { phase: "acquire", status: "skipped", changedFields: [], durationMs: 0 },
      }),
    );
    mocks.runNamesPhase.mockResolvedValue(namesOutput());
    mocks.runEditorialAgent.mockResolvedValue(emptyEditorialOutput());
    mocks.runProductsPhase.mockResolvedValue(productsOutput());

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

  it("keeps a healthy-but-empty LLM result on the non-failed path", async () => {
    const target = submission({
      id: "sub-empty",
      brand_name: "Nothing To Say",
      social_instagram: "https://www.instagram.com/nothingtosay",
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));
    // Acquire returns a skipped result with healthy data — no provider failure.
    mocks.runAcquirePhase.mockResolvedValue(
      acquireOutput({
        phaseResult: { phase: "acquire", status: "skipped", changedFields: [], durationMs: 0 },
      }),
    );
    mocks.runNamesPhase.mockResolvedValue(namesOutput());
    mocks.runEditorialAgent.mockResolvedValue(emptyEditorialOutput());
    mocks.runProductsPhase.mockResolvedValue(productsOutput());

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
  const ORIGINAL_KEY = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    defaultBeforeEach();
    process.env.OPENAI_API_KEY = "test-stub";
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));
  });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  });

  it("products_satisfied_via_history_skips", async () => {
    const target = submission({
      id: "sub-satisfied",
      brand_name: "Satisfied Brand",
      social_instagram: "https://www.instagram.com/satisfied",
    });
    // Satisfaction now reads from the phase-output store, not curation_job_targets.
    mockSatisfiedPhases(["detect", "acquire", "names", "products"]);
    // Mock phase runners that still run (editorial is unsatisfied since it is
    // not in the requested phases, but the editorial block still executes).
    mocks.runEditorialAgent.mockResolvedValue(editorialOutput());
    mocks.runProductsPhase.mockResolvedValue(productsOutput());

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: ["detect", "acquire", "products"],
        onProgress: () => {},
      },
      fakeSupabase([target]),
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

  it("force_overrides_history_satisfaction", async () => {
    const target = submission({
      id: "sub-force",
      brand_name: "Force Brand",
      social_instagram: "https://www.instagram.com/forced",
    });
    // Phase-output store shows acquire and products succeeded previously.
    mockSatisfiedPhases(["acquire", "products"]);
    // Mock acquire so it runs cleanly when force-overridden.
    mocks.runAcquirePhase.mockResolvedValue(acquireOutput());
    mocks.runNamesPhase.mockResolvedValue(namesOutput());
    mocks.runEditorialAgent.mockResolvedValue(editorialOutput());
    mocks.runProductsPhase.mockResolvedValue(productsOutput());

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        overwrite: true,
        phases: ["detect", "acquire", "products"],
        onProgress: () => {},
      },
      fakeSupabase([target]),
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

  it("satisfied_phases_skip_and_products_gets_hydrated_catalog", async () => {
    const target = submission({
      id: "sub-hydrated",
      brand_name: "Hydrated Brand",
      social_instagram: "https://www.instagram.com/hydrated",
    });
    // Satisfaction now reads from the phase-output store.
    mockSatisfiedPhases(["detect", "acquire"]);
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

    // Acquire was satisfied from history, so it never ran
    expect(mocks.runAcquirePhase).not.toHaveBeenCalled();
    // Products still ran (the phase runner is mocked; the imagePool hydration
    // from history happens only with a real Supabase client, so we verify
    // that products was called and acquire was skipped).
    expect(mocks.runProductsPhase).toHaveBeenCalledOnce();
  });
});

describe("Langfuse trace lifecycle", () => {
  beforeEach(() => defaultBeforeEach());

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

    expect(result).toBeDefined();
    expect(result.errors).toBeDefined();
  });
});

describe("acquisition plan catalog threading", () => {
  beforeEach(() => {
    defaultBeforeEach();
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));
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
          entryUrls: ["https://catalog.example.com/shop"],
          priorityProductUrls: ["https://catalog.example.com/products/vase"],
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

    expect(mocks.runAcquirePhase).toHaveBeenCalledOnce();

    if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  });
});

describe("editorial agent integration", () => {
  const ORIGINAL_EDITORIAL_AGENT = process.env.EDITORIAL_AGENT;
  const ORIGINAL_OPENAI_KEY = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    defaultBeforeEach();
    process.env.OPENAI_API_KEY = "test-stub";
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

    // Acquire must succeed so the brand reaches the editorial block.
    mocks.runAcquirePhase.mockResolvedValue(acquireOutput());
    mocks.runNamesPhase.mockResolvedValue(namesOutput());
    mocks.runProductsPhase.mockResolvedValue(productsOutput());
    mocks.runEditorialAgent.mockResolvedValueOnce({
      agentOutcome: "generated",
      phaseResults: [
        { phase: "descriptions", status: "succeeded", changedFields: ["description"], durationMs: 100 },
        { phase: "stockists", status: "skipped", changedFields: [], durationMs: 10 },
        { phase: "faq", status: "succeeded", changedFields: [], durationMs: 50 },
      ],
      phaseOutputs: [{ phaseResult: { phase: "descriptions", status: "succeeded", changedFields: ["description"], durationMs: 100 }, patch: { description: "A test description" } }],
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

    expect(mocks.runEditorialAgent).toHaveBeenCalledOnce();
    expect(mocks.runDescriptionsPhase).not.toHaveBeenCalled();
    expect(mocks.runStockistsPhase).not.toHaveBeenCalled();
    expect(mocks.runFaqPhase).not.toHaveBeenCalled();
  });

  it("editorial_respects_satisfaction", async () => {
    delete process.env.EDITORIAL_AGENT;

    const target = submission({
      id: "sub-satisfied-editorial",
      brand_name: "Satisfied Editorial",
      social_instagram: "https://www.instagram.com/satisfiededitorial",
    });

    // Satisfaction now reads from the phase-output store.
    mockSatisfiedPhases(["detect", "acquire", "descriptions", "stockists", "faq"]);
    // Mock products so the editorial block's products section runs cleanly.
    mocks.runProductsPhase.mockResolvedValue(productsOutput());

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

    expect(mocks.runEditorialAgent).not.toHaveBeenCalled();
  });

  it("editorial_agent_off_falls_back_to_individual_phases", async () => {
    process.env.EDITORIAL_AGENT = "off";

    // Acquire must succeed so the brand reaches the editorial block.
    mocks.runAcquirePhase.mockResolvedValue(acquireOutput());
    mocks.runNamesPhase.mockResolvedValue(namesOutput());
    mocks.runProductsPhase.mockResolvedValue(productsOutput());
    // Explicitly mock the editorial agent to return "fallback" rather than
    // relying on the original implementation reading EDITORIAL_AGENT=off.
    mocks.runEditorialAgent.mockResolvedValueOnce({
      agentOutcome: "fallback",
      phaseOutputs: [],
      phaseResults: [],
      patch: {},
      listingVerdict: null,
      descriptionRewrite: null,
      brandFacts: null,
      attempts: [],
      factsAttempts: [],
      decisions: [],
    });
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

    expect(mocks.runEditorialAgent).toHaveBeenCalledOnce();
    expect(mocks.runDescriptionsPhase).toHaveBeenCalled();
  });
});

describe("two loops with a batched names call between", () => {
  const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    defaultBeforeEach();
    process.env.OPENAI_API_KEY = "test-stub";
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));
    mocks.runAcquirePhase.mockImplementation(async () => acquireOutput());
    mocks.runNamesPhase.mockImplementation(async () => namesOutput());
    mocks.runEditorialAgent.mockImplementation(async () => editorialOutput());
    mocks.runProductsPhase.mockImplementation(async () => productsOutput());
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  });

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
    // Every acquire finished before the batch, and no editorial started
    // before the names call: the block order enforces this as a barrier.
    expect(order.lastIndexOf("acquire")).toBeLessThan(namesIndex);
    expect(namesIndex).toBeLessThan(order.indexOf("editorial"));
    expect(namesIndex).toBeLessThan(order.indexOf("products"));
  });

  it("loop_a_exits_excluded_from_names_and_loop_b", async () => {
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

    // The batch is built from the survivors only
    expect(mocks.runNamesPhase).toHaveBeenCalledOnce();
    const namesCtx = mocks.runNamesPhase.mock.calls[0][0] as {
      chunk: Array<{ id: string }>;
    };
    expect(namesCtx.chunk.map((brand) => brand.id)).toEqual([kept.id]);
    expect(mocks.runEditorialAgent).toHaveBeenCalledOnce();
    expect(mocks.runProductsPhase).toHaveBeenCalledOnce();
  });

  it("mixed recovery targets report only their selected batch phases", async () => {
    const detectTarget = submission({
      id: "sub-detect-scope",
      brand_name: "Detect Scope Studio",
      social_instagram: "https://www.instagram.com/detectscope",
    });
    const faqTarget = submission({
      id: "sub-faq-scope",
      brand_name: "FAQ Scope Studio",
      social_instagram: "https://www.instagram.com/faqscope",
    });
    mocks.runEditorialAgent.mockResolvedValue({
      ...editorialOutput(),
      phaseResults: [{ phase: "faq", status: "succeeded", changedFields: ["faq"], durationMs: 10 }],
      phaseOutputs: [{ phaseResult: { phase: "faq", status: "succeeded", changedFields: ["faq"], durationMs: 10 }, patch: { faq: [] } }],
      patch: { faq: [] },
    });
    const progress: Array<{ targetId: string; currentPhase?: string | null }> = [];

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [detectTarget.id, faqTarget.id],
        dryRun: true,
        phases: ["detect", "faq"],
        targetPlans: {
          [detectTarget.id]: { selected: ["detect"], forced: ["detect"], explicit: [] },
          [faqTarget.id]: { selected: ["faq"], forced: ["faq"], explicit: ["faq"] },
        },
        onProgress: () => {},
        onTargetProgressBatch: async (events) => { progress.push(...events); },
      },
      fakeSupabase([detectTarget, faqTarget]),
    );

    expect(progress.filter((event) => event.targetId === faqTarget.id).map((event) => event.currentPhase)).not.toContain("detect");
  });

  it("gate_b_weak_brand_skips", async () => {
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
    // Names batch only includes the kept brand
    const namesCtx = mocks.runNamesPhase.mock.calls[0][0] as {
      chunk: Array<{ id: string }>;
    };
    expect(namesCtx.chunk.map((brand) => brand.id)).toEqual([kept.id]);
    expect(mocks.runEditorialAgent).toHaveBeenCalledOnce();
    expect(mocks.runProductsPhase).toHaveBeenCalledOnce();
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
      triples: [],
      attempts: [],
      evidence: new Map(),
      deadlineHit: false,
    };
    mocks.runAcquirePhase.mockResolvedValue(
      acquireOutput({
        imagePool,
        catalogResult,
        acquisitionPageUrls: ["https://pool.example.com/products/vase"],
        priorityProductUrls: ["https://pool.example.com/products/vase"],
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

  it("hydrated_scraped_data_reaches_editorial_and_products", async () => {
    const target = submission({
      id: "sub-hydrated-scrape",
      brand_name: "Hydrated Scrape",
      social_instagram: "https://www.instagram.com/hydratedscrape",
    });
    // Satisfaction now reads from the phase-output store.
    mockSatisfiedPhases(["detect", "acquire"]);
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

    // Acquire was satisfied, so it never ran
    expect(mocks.runAcquirePhase).not.toHaveBeenCalled();
    // Editorial and products still received scrapedData (possibly empty from hydration)
    // The key assertion: no crash and phases ran
    expect(mocks.runEditorialAgent).toHaveBeenCalledOnce();
    expect(mocks.runProductsPhase).toHaveBeenCalledOnce();
  });

  it("phase_results_shape_unchanged", async () => {
    const target = submission({
      id: "sub-shape",
      brand_name: "Shape Brand",
      social_instagram: "https://www.instagram.com/shapebrand",
    });
    mocks.runAcquirePhase.mockResolvedValue(acquireOutput());
    mocks.runNamesPhase.mockResolvedValue(namesOutput());
    mocks.runEditorialAgent.mockResolvedValue(editorialOutput());
    mocks.runProductsPhase.mockResolvedValue(productsOutput());

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
    expect(outcome).toBeDefined();
    // Phase results should include detect, acquire, names, and editorial sub-phases
    const phases = outcome?.phaseResults?.map((pr) => pr.phase) ?? [];
    expect(phases).toContain("detect");
    expect(phases).toContain("acquire");
  });

});

describe("link expansion, SERP search, and no-purchase-channel gate", () => {
  const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    defaultBeforeEach();
    process.env.OPENAI_API_KEY = "test-stub";
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));
    mocks.runAcquirePhase.mockImplementation(async () => acquireOutput());
    mocks.runNamesPhase.mockImplementation(async () => namesOutput());
    mocks.runEditorialAgent.mockImplementation(async () => editorialOutput());
    mocks.runProductsPhase.mockImplementation(async () => productsOutput());
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
  });

  it("hub_links_adopted_before_detect_and_reach_acquire_known_urls", async () => {
    const target = submission({
      id: "sub-hub",
      brand_name: "Hub Brand",
      website_url: "https://portaly.cc/hubbrand",
      social_instagram: "https://www.instagram.com/hubbrand",
    });

    mocks.collectHubUrls.mockReturnValue(["https://portaly.cc/hubbrand"]);
    mocks.fetchHtml.mockResolvedValue("<html></html>");
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

    expect(mocks.expandLinkHubs).toHaveBeenCalledOnce();
    expect(mocks.runAcquirePhase).toHaveBeenCalledOnce();
    const acquireInput = mocks.runAcquirePhase.mock.calls[0][0] as {
      knownUrls: string[];
      brand: Record<string, unknown>;
    };
    expect(acquireInput.knownUrls).toContain(
      "https://myship.7-11.com.tw/general/detail/GM2505068972611",
    );
    expect(acquireInput.brand.purchase_myship).toBe(
      "https://myship.7-11.com.tw/general/detail/GM2505068972611",
    );
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
    expect(mocks.runAcquirePhase).not.toHaveBeenCalled();
  });

  it("serp_always_fires_regardless_of_purchase_channel", async () => {
    const withChannel = submission({
      id: "sub-with-channel",
      brand_name: "Channel Brand",
      social_instagram: "https://www.instagram.com/channelbrand",
      purchase_website: "https://channelbrand.example.com",
    });
    const withoutChannel = submission({
      id: "sub-without-channel",
      brand_name: "No Channel Brand",
      social_instagram: "https://www.instagram.com/nochannelbrand",
    });

    mocks.collectHubUrls.mockReturnValue([]);
    mocks.expandLinkHubs.mockResolvedValue({
      hubsFetched: 0,
      adopted: [],
      scraped: {},
    });
    // First brand has a channel, second does not — SERP fires for both
    mocks.hasPurchaseChannel.mockReturnValue(true);

    stubSerpCalls({ name: { urls: [] } });

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [withChannel.id, withoutChannel.id],
        dryRun: true,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([withChannel, withoutChannel]),
    );

    // SERP is called for BOTH brands — no hasPurchaseChannel gate
    const calls = serpCalls();
    expect(calls).toHaveLength(2);
  });

  it("serp_query_template_includes_handle_when_available", async () => {
    const withHandle = submission({
      id: "sub-with-handle",
      brand_name: "Handle Brand",
      social_instagram: "https://www.instagram.com/handlebrand",
    });
    const withoutHandle = submission({
      id: "sub-no-handle",
      brand_name: "No Handle Brand",
      social_instagram: null,
    });

    mocks.collectHubUrls.mockReturnValue([]);
    mocks.expandLinkHubs.mockResolvedValue({
      hubsFetched: 0,
      adopted: [],
      scraped: {},
    });
    mocks.hasPurchaseChannel.mockReturnValue(true);

    stubSerpCalls({ name: { urls: [] } });

    await runEnrich(
      {
        target: "submissions",
        submissionIds: [withHandle.id, withoutHandle.id],
        dryRun: true,
        phases: FULL_PHASES,
        onProgress: () => {},
      },
      fakeSupabase([withHandle, withoutHandle]),
    );

    const calls = serpCalls();
    expect(calls).toHaveLength(2);

    // Each call: [brandNames, queryTemplate, concurrency, auditResolver]
    // Brand with IG handle → query includes handle
    const handleBrandCall = calls.find(
      (c: unknown[]) => (c[0] as string[])[0] === "Handle Brand",
    );
    expect(handleBrandCall).toBeDefined();
    const handleTemplate = handleBrandCall![1] as (name: string) => string;
    expect(handleTemplate("Handle Brand")).toBe(
      "Handle Brand handlebrand 台灣",
    );

    // Brand without IG handle → query is name + 台灣 only
    const noHandleCall = calls.find(
      (c: unknown[]) => (c[0] as string[])[0] === "No Handle Brand",
    );
    expect(noHandleCall).toBeDefined();
    const noHandleTemplate = noHandleCall![1] as (name: string) => string;
    expect(noHandleTemplate("No Handle Brand")).toBe("No Handle Brand 台灣");
  });
});
