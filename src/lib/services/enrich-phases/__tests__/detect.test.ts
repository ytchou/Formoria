import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDetectResult,
  runDetectPhase,
} from "../detect";
import type {
  DetectItem,
} from "../../category-classifier";

/**
 * The single-brand helper is mocked (rather than spied) because vitest cannot
 * redefine a live ESM export binding. `importOriginal` keeps every parser in
 * the module real — only the network-calling entry point is replaced.
 */
const mocks = vi.hoisted(() => ({
  detectBrand: vi.fn(),
}));

vi.mock("../../category-classifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../category-classifier")>()),
  detectBrand: mocks.detectBrand,
}));
import type { BatchPhaseContext, EnrichBrand, EnrichPhase } from "../types";
import type { DetectResult } from "../../category-classifier";

const brand: EnrichBrand = {
  id: "brand-1",
  slug: "test-brand",
  name: "Test Brand",
  description: "Original description",
  category: null,
  purchase_website: "https://test.example",
};

const brandDetect: DetectResult = {
  isNonBrand: false,
  nonBrandReason: null,
  brandName: null,
  slug: "test-brand",
  slugGenerated: "better-brand",
  categorySlug: "skincare",
  confidence: "high",
};

const secondBrand: EnrichBrand = {
  ...brand,
  id: "brand-2",
  slug: "second-brand",
  name: "Second Brand",
};

const healthyEmpty = { value: null, calls: { attempted: 1, providerFailed: 0 } };
const providerDown = { value: null, calls: { attempted: 1, providerFailed: 1 } };

function firstItem(): DetectItem {
  return mocks.detectBrand.mock.calls[0][0] as DetectItem;
}

function ctx(overrides: Partial<BatchPhaseContext> = {}): BatchPhaseContext {
  return {
    chunk: [brand],
    chunkBrandNames: ["Test Brand"],
    phases: ["detect"] as EnrichPhase[],
    dryRun: true,
    supabase: null as unknown as BatchPhaseContext["supabase"],
    ...overrides,
  };
}

// The probe assertions below read `mock.calls[0]`, which is the first call in
// the whole FILE unless the recorded calls are cleared between tests. Vitest is
// not configured with `clearMocks`, so clear them here. `clearAllMocks` drops
// recorded calls only — the `mockResolvedValue` each test sets survives.
beforeEach(() => {
  vi.clearAllMocks();
});

describe("runDetectPhase", () => {
  it("returns skipped when no detect phases requested", async () => {
    const result = await runDetectPhase(
      ctx({ phases: ["links"] as EnrichPhase[] }),
      new Map(),
      new Map(),
      new Map(),
    );

    expect(result.phaseResult.status).toBe("skipped");
    expect(result.detectResults.size).toBe(0);
  });

  it("fails the phase when every detect call died at the provider", async () => {
    // An empty result map used to read as "no non-brands found" and the phase
    // reported `succeeded` — the root cause of the 407 falsely-green targets on
    // 2026-08-02.
    mocks.detectBrand.mockResolvedValue(providerDown);

    const result = await runDetectPhase(
      ctx({
        chunk: [brand, secondBrand],
        chunkBrandNames: ["Test Brand", "Second Brand"],
      }),
      new Map(),
      new Map(),
      new Map(),
    );

    expect(result.phaseResult.status).toBe("failed");
    expect(result.phaseResult.providerFailure).toBe(true);
    expect(result.phaseResult.error).toContain("all 2 detect call(s)");
  });

  it("keeps an empty result from a healthy provider on the succeeded path", async () => {
    mocks.detectBrand.mockResolvedValue(healthyEmpty);

    const result = await runDetectPhase(ctx(), new Map(), new Map(), new Map());

    expect(result.phaseResult.status).toBe("succeeded");
    expect(result.phaseResult.providerFailure).toBeUndefined();
  });

  it("makes one detect call per brand, each with its own brand", async () => {
    mocks.detectBrand.mockResolvedValue(healthyEmpty);

    await runDetectPhase(
      ctx({
        chunk: [brand, secondBrand],
        chunkBrandNames: ["Test Brand", "Second Brand"],
        jobId: "job-1",
      }),
      new Map([
        [
          "Second Brand",
          {
            urls: [],
            snippets: ["second snippet"],
            entries: [
              {
                title: "Second Brand",
                link: "https://second.example",
                snippet: "second snippet",
              },
            ],
          },
        ],
      ]),
      new Map(),
      new Map(),
    );

    expect(mocks.detectBrand).toHaveBeenCalledTimes(2);
    const items = mocks.detectBrand.mock.calls.map(
      ([item, jobId]) => [(item as DetectItem).slug, jobId] as const,
    );
    expect(items).toEqual([
      ["test-brand", "job-1"],
      ["second-brand", "job-1"],
    ]);
    const second = mocks.detectBrand.mock.calls[1][0] as DetectItem;
    expect(second.results).toEqual([
      { title: "Second Brand", snippet: "second snippet", host: "second.example", match: null },
    ]);
    expect(second.target).toEqual({ type: "brand", id: "brand-2" });
  });

  it("keeps the other brands' results when one brand's call fails", async () => {
    mocks.detectBrand.mockImplementation(async (item: DetectItem) =>
      item.slug === "test-brand"
        ? providerDown
        : {
            value: { ...brandDetect, slug: item.slug },
            calls: { attempted: 1, providerFailed: 0 },
          },
    );

    const result = await runDetectPhase(
      ctx({
        chunk: [brand, secondBrand],
        chunkBrandNames: ["Test Brand", "Second Brand"],
      }),
      new Map(),
      new Map(),
      new Map(),
    );

    // One of two calls died at the provider: not every call, so the phase
    // succeeds and the healthy brand keeps its verdict.
    expect(result.phaseResult.status).toBe("succeeded");
    expect(result.detectResults.has("test-brand")).toBe(false);
    expect(result.detectResults.get("second-brand")?.slug).toBe("second-brand");
  });

  /**
   * DEV-1644 F10: the orchestrator probed every known URL and threw the answer
   * away, so detect judged brands on SERP snippets alone. The map is keyed by
   * TARGET ID, like every other per-brand map handed to a batch phase.
   */
  it("probe_evidence_reaches_detect_prompt", async () => {
    mocks.detectBrand.mockResolvedValue(healthyEmpty);

    await runDetectPhase(
      ctx(),
      new Map(),
      new Map([
        [
          "brand-1",
          [
            {
              url: "https://test.example",
              title: "Test Brand Official Site",
              description: "Handmade ceramics from Taipei",
              platform: "instagram",
              status: 200,
            },
          ],
        ],
      ]),
      new Map(),
    );

    // `status` is kept (DEV-1894): the renderer shows it on a failed probe.
    expect(firstItem().probes).toEqual([
      {
        url: "https://test.example",
        title: "Test Brand Official Site",
        description: "Handmade ceramics from Taipei",
        platform: "instagram",
        status: 200,
      },
    ]);
  });

  it("failed_probe_reaches_detect", async () => {
    mocks.detectBrand.mockResolvedValue(healthyEmpty);

    await runDetectPhase(
      ctx(),
      new Map(),
      // A dead submitted site is evidence too: the probe read no <head>, but
      // its 404 says the page is gone.
      new Map([["brand-1", [{ url: "https://test.example", status: 404 }]]]),
      new Map(),
    );

    expect(firstItem().probes).toEqual([
      { url: "https://test.example", status: 404 },
    ]);
  });

  it("detect_item_carries_results_with_tags", async () => {
    mocks.detectBrand.mockResolvedValue(healthyEmpty);

    await runDetectPhase(
      ctx(),
      new Map([
        [
          "Test Brand",
          {
            urls: [],
            snippets: ["own", "other"],
            entries: [
              {
                title: "Test Brand Official",
                link: "https://www.test.example/about",
                snippet: "own",
              },
              {
                title: "Someone Else",
                link: "https://other.example/test-brand",
                snippet: "other",
              },
            ],
          },
        ],
      ]),
      new Map(),
      new Map([["brand-1", ["https://test.example"]]]),
    );

    const item = firstItem();
    expect(item.results?.map((line) => line.match)).toEqual(["site", null]);
    expect(item).not.toHaveProperty("snippets");
  });

  it("detect_item_carries_submitted_website", async () => {
    mocks.detectBrand.mockResolvedValue(healthyEmpty);

    await runDetectPhase(
      ctx({
        chunk: [{ ...brand, website_url: "https://submitted.example" }],
      }),
      new Map(),
      new Map(),
      new Map(),
    );

    expect(firstItem().submittedWebsite).toBe("https://submitted.example");
  });

  it("probe_cap_still_four", async () => {
    mocks.detectBrand.mockResolvedValue(healthyEmpty);

    await runDetectPhase(
      ctx(),
      new Map(),
      new Map([
        [
          "brand-1",
          Array.from({ length: 6 }, (_, index) => ({
            url: `https://test.example/${index}`,
            title: `Page ${index}`,
          })),
        ],
      ]),
      new Map(),
    );

    expect(firstItem().probes).toHaveLength(4);
  });
});

describe("applyDetectResult", () => {
  it("returns non-brand skip result for high-confidence non-brands", () => {
    const result = applyDetectResult(
      {
        ...brandDetect,
        isNonBrand: true,
        nonBrandReason: "directory",
      },
      brand,
    );

    expect(result.isNonBrand).toBe(true);
    expect(result.phaseResult.status).toBe("skipped");
    expect(result.patch).toEqual({});
    expect(result.brandName).toBeNull();
  });

  it("returns brand result with detect patch for valid brands", () => {
    const result = applyDetectResult(brandDetect, brand);

    expect(result.isNonBrand).toBe(false);
    expect(result.phaseResult.status).toBe("succeeded");
    expect(result.patch).toEqual({ slug: "better-brand" });
  });

  it.each(["medium", "low"] as const)(
    "preserves the current slug when detect confidence is %s",
    (confidence) => {
      const result = applyDetectResult(
        { ...brandDetect, confidence, slugGenerated: "unapproved-slug" },
        { ...brand, slug: "current-slug" },
      );

      expect(result.patch).not.toHaveProperty("slug");
    },
  );

  // The detect prompt tells the model to return a null slug rather than
  // transliterate a Han name. The model obeys; the generateSlug fallback then
  // Wade-Giles romanised it anyway (`yuan-hsing-tung-fang-cha-yin-pur-sweets`).
  it("leaves the slug untouched for a Han name with no model slug", () => {
    const result = applyDetectResult(
      { ...brandDetect, slugGenerated: null, brandName: "茶籽堂 Cha Tzu Tang" },
      { ...brand, name: "茶籽堂", slug: "chatzutang" },
    );

    // `name` is no longer written here — DEV-1321 made `names` the single
    // writer, so detect only exposes the candidate.
    expect(result.patch).not.toHaveProperty("name");
    expect(result.brandName).toBe("茶籽堂 Cha Tzu Tang");
    expect(result.patch).not.toHaveProperty("slug");
  });

  it("still generates a slug for a Latin name with no model slug", () => {
    const result = applyDetectResult(
      { ...brandDetect, slugGenerated: null, brandName: "ADELA Studio" },
      { ...brand, name: "Adela", slug: "adela" },
    );

    expect(result.patch.slug).toBe("adela-studio");
    expect(result.patch).not.toHaveProperty("name");
    expect(result.brandName).toBe("ADELA Studio");
  });

});
