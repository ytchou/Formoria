import { describe, expect, it, vi } from "vitest";
import {
  applyDetectResult,
  runStandaloneClassification,
  runDetectPhase,
} from "../detect";
import type { BatchClassificationItem } from "../../category-classifier";

/**
 * The two batch helpers are mocked (rather than spied) because vitest cannot
 * redefine a live ESM export binding. `importOriginal` keeps every parser in
 * the module real — only the two network-calling entry points are replaced.
 */
const mocks = vi.hoisted(() => ({
  detectBrandsBatch: vi.fn(),
  classifyCategoryBatch: vi.fn(),
}));

vi.mock("../../category-classifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../category-classifier")>()),
  detectBrandsBatch: mocks.detectBrandsBatch,
  classifyCategoryBatch: mocks.classifyCategoryBatch,
}));

void (null as BatchClassificationItem | null);
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

describe("runDetectPhase", () => {
  it("returns skipped when no detect phases requested", async () => {
    const result = await runDetectPhase(
      ctx({ phases: ["links"] as EnrichPhase[] }),
      new Map(),
    );

    expect(result.phaseResult.status).toBe("skipped");
    expect(result.detectResults.size).toBe(0);
  });

  // `tags` belongs to the DETAIL step and detect no longer produces a category,
  // so a tags-only run must not pay for a detect LLM call.
  it("does not trigger detect for a tags-only run", async () => {
    const result = await runDetectPhase(
      ctx({ phases: ["tags"] as EnrichPhase[] }),
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
});

describe("runStandaloneClassification", () => {
  it("skips standalone classification when tags phase is not requested", async () => {
    const result = await runStandaloneClassification(
      ctx({ phases: ["descriptions"] as EnrichPhase[] }),
    );

    expect(result.phaseResult.status).toBe("skipped");
    expect(result.batchClassifications.size).toBe(0);
  });

  it("fails the phase when every classification call died at the provider", async () => {
    mocks.classifyCategoryBatch.mockResolvedValue({
      results: new Map(),
      calls: { attempted: 1, providerFailed: 1 },
    });

    const result = await runStandaloneClassification(
      ctx({ phases: ["tags"] as EnrichPhase[] }),
    );

    expect(result.phaseResult.status).toBe("failed");
    expect(result.phaseResult.providerFailure).toBe(true);
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

  // DETECT_SYSTEM_PROMPT tells the model to return a null slug rather than
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

  it("never writes category, even when tags is requested", () => {
    // The category moved to the descriptions phase, which sees the brand's own
    // site text and its classified image alt text. Detect sees SERP snippets.
    const result = applyDetectResult(
      { ...brandDetect, categorySlug: "beauty" },
      brand,
      ["detect", "slugs", "tags"] as EnrichPhase[],
    );

    expect(result.patch).not.toHaveProperty("category");
  });
});
