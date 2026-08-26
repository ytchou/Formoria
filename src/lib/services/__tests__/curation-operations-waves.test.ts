import { beforeEach, describe, expect, it, vi } from "vitest";
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
 * Only two chains are exercised: the submission fetch in `runEnrich` and the
 * active-image count in the image-search phase. Both terminate in an awaited
 * thenable, so the builder is a self-returning proxy with a fixed payload.
 */
function fakeSupabase(submissions: SubmissionRow[]): SupabaseClient {
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
    ]) {
      chain[method] = () => chain;
    }
    return chain;
  };

  return {
    from: (table: string) =>
      builder(table === "brand_submissions" ? submissions : []),
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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLatestSearchResults.mockResolvedValue(new Map());
    mocks.batchSearchBrandImages.mockResolvedValue(new Map());
    mocks.scrapeBrandUrls.mockResolvedValue(scrapeResult());
  });

  /**
   * A submission whose `enriched_data.products` already has entries should skip
   * the products phase with the satisfaction detail, not re-run it.
   */
  it("satisfied_prerequisites_are_skipped", async () => {
    const target = submission({
      id: "sub-satisfied",
      brand_name: "Satisfied Brand",
      // A known URL so Gate B ("no enrichment inputs") does not fire before
      // the per-phase loop where satisfaction skipping is visible.
      social_instagram: "https://www.instagram.com/satisfied",
      enriched_data: {
        products: [{ name: "Existing Product", official_url: "https://example.com/p1" }],
      },
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));

    // Phases include products — it should be skipped via satisfaction, not run.
    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        phases: ["detect", "links", "images", "products"],
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    const outcome = result.brandOutcomes.find(
      (entry) => entry?.submissionId === target.id,
    );
    // The products phase should appear as skipped with satisfaction detail.
    const productsPhase = outcome?.phaseResults?.find(
      (pr) => pr.phase === "products",
    );
    expect(productsPhase).toBeDefined();
    expect(productsPhase?.status).toBe("skipped");
    expect(productsPhase?.detail).toBe("phase output already satisfied");
  });

  /**
   * When force (overwrite) is set, satisfaction predicates are bypassed and
   * every phase runs regardless of existing data.
   */
  it("force_overrides_satisfaction", async () => {
    const target = submission({
      id: "sub-force",
      brand_name: "Force Brand",
      // A known URL so Gate B ("no enrichment inputs") does not fire before
      // the per-phase loop where the forced products phase runs.
      social_instagram: "https://www.instagram.com/forced",
      enriched_data: {
        products: [{ name: "Existing Product", official_url: "https://example.com/p1" }],
      },
    });
    mocks.detectBrandsBatch.mockResolvedValue(detectBatch(new Map()));

    const result = await runEnrich(
      {
        target: "submissions",
        submissionIds: [target.id],
        dryRun: true,
        overwrite: true,
        phases: ["detect", "links", "images", "products"],
        onProgress: () => {},
      },
      fakeSupabase([target]),
    );

    const outcome = result.brandOutcomes.find(
      (entry) => entry?.submissionId === target.id,
    );
    // With force, products should NOT be satisfaction-skipped.
    const productsPhase = outcome?.phaseResults?.find(
      (pr) => pr.phase === "products",
    );
    expect(productsPhase).toBeDefined();
    // It might be skipped for other reasons (e.g. "not in scope" inside the
    // phase runner), but NOT with the satisfaction detail.
    expect(productsPhase?.detail).not.toBe("phase output already satisfied");
  });
});
