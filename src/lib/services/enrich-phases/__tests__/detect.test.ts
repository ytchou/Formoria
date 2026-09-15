import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDetectResult,
  runDetectPhase,
} from "../detect";
import type {
  DetectBatchItem,
} from "../../category-classifier";

/**
 * The two batch helpers are mocked (rather than spied) because vitest cannot
 * redefine a live ESM export binding. `importOriginal` keeps every parser in
 * the module real — only the two network-calling entry points are replaced.
 */
const mocks = vi.hoisted(() => ({
  detectBrandsBatch: vi.fn(),
}));

vi.mock("../../category-classifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../category-classifier")>()),
  detectBrandsBatch: mocks.detectBrandsBatch,
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
    );

    expect(result.phaseResult.status).toBe("skipped");
    expect(result.detectResults.size).toBe(0);
  });

  it("fails the phase when every detect call died at the provider", async () => {
    // An empty result map used to read as "no non-brands found" and the phase
    // reported `succeeded` — the root cause of the 407 falsely-green targets on
    // 2026-08-02.
    mocks.detectBrandsBatch.mockResolvedValue({
      results: new Map(),
      calls: { attempted: 2, providerFailed: 2 },
    });

    const result = await runDetectPhase(ctx(), new Map());

    expect(result.phaseResult.status).toBe("failed");
    expect(result.phaseResult.providerFailure).toBe(true);
  });

  it("keeps an empty result from a healthy provider on the succeeded path", async () => {
    mocks.detectBrandsBatch.mockResolvedValue({
      results: new Map(),
      calls: { attempted: 1, providerFailed: 0 },
    });

    const result = await runDetectPhase(ctx(), new Map());

    expect(result.phaseResult.status).toBe("succeeded");
    expect(result.phaseResult.providerFailure).toBeUndefined();
  });

  /**
   * DEV-1644 F10: the orchestrator probed every known URL and threw the answer
   * away, so detect judged brands on SERP snippets alone. The map is keyed by
   * TARGET ID, like every other per-brand map handed to a batch phase.
   */
  it("probe_evidence_reaches_detect_prompt", async () => {
    mocks.detectBrandsBatch.mockResolvedValue({
      results: new Map(),
      calls: { attempted: 1, providerFailed: 0 },
    });

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
    );

    const items = mocks.detectBrandsBatch.mock.calls[0][0] as DetectBatchItem[];
    // `status` is dropped: it steers the probe, it does not describe the brand.
    expect(items[0].probes).toEqual([
      {
        url: "https://test.example",
        title: "Test Brand Official Site",
        description: "Handmade ceramics from Taipei",
        platform: "instagram",
      },
    ]);
  });

  it("probe_evidence_without_head_text_is_dropped", async () => {
    mocks.detectBrandsBatch.mockResolvedValue({
      results: new Map(),
      calls: { attempted: 1, providerFailed: 0 },
    });

    await runDetectPhase(
      ctx(),
      new Map(),
      // A timed-out probe carries only the url it was asked about. Passing it
      // on would spend prompt tokens restating the item's own website line.
      new Map([["brand-1", [{ url: "https://test.example", platform: "instagram" }]]]),
    );

    const items = mocks.detectBrandsBatch.mock.calls[0][0] as DetectBatchItem[];
    expect(items[0].probes).toBeUndefined();
  });

  it("caps probe evidence at four urls per brand", async () => {
    mocks.detectBrandsBatch.mockResolvedValue({
      results: new Map(),
      calls: { attempted: 1, providerFailed: 0 },
    });

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
    );

    const items = mocks.detectBrandsBatch.mock.calls[0][0] as DetectBatchItem[];
    expect(items[0].probes).toHaveLength(4);
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
