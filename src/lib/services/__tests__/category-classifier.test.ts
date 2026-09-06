import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  parseExtractionResult,
  detectBrandsBatch,
  type DetectBatchItem,
  type DetectResult,
  detectSingleShape,
  detectBatchShape,
  classifySingleShape,
  classifyBatchShape,
} from "../category-classifier";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";

const promptMeta = { name: "detect", version: 2 };
vi.mock("@/lib/langfuse/prompt", () => ({
  fetchLangfusePrompt: vi.fn((_n: string, fb: string) => Promise.resolve(fb)),
  fetchLangfusePromptWithMeta: vi.fn((_n: string, fb: string) =>
    Promise.resolve({ text: fb, prompt: promptMeta }),
  ),
}));

const mockFetch = vi.fn();
void (null as DetectResult | null);

describe("detectBrandsBatch", () => {
  beforeEach(() => {
    mockFetch.mockClear();
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const brands: DetectBatchItem[] = [
    {
      slug: "my-brand",
      name: "My Brand",
      description: "Handmade soap",
      website: "https://mybrand.com",
    },
    {
      slug: "some-reseller",
      name: "代購小舖",
      description: null,
      website: null,
    },
  ];

  it("parses a detect response that omits categorySlug", async () => {
    // The detect prompt no longer asks for a category, so the key is absent.
    // The triage result must still carry the non-brand gate and the name/slug.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [
                  {
                    slug: "my-brand",
                    reasoning: "Clearly a product brand",
                    isNonBrand: false,
                    nonBrandReason: null,
                    brand_name: "My Brand",
                    slug_generated: "my-brand",
                    confidence: "high",
                  },
                  {
                    slug: "some-reseller",
                    reasoning: "This is a reseller",
                    isNonBrand: true,
                    nonBrandReason: "代購 (reseller)",
                    brand_name: null,
                    slug_generated: "some-reseller",
                    confidence: "high",
                  },
                ],
              }),
            },
          },
        ],
      }),
    });

    const { results } = await detectBrandsBatch(brands);

    expect(results.size).toBe(2);
    expect(results.get("my-brand")!.categorySlug).toBeNull();
    expect(results.get("my-brand")!.brandName).toBe("My Brand");
    expect(results.get("some-reseller")!.isNonBrand).toBe(true);
  });

  it("returns detect results for each brand in the batch", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [
                  {
                    slug: "my-brand",
                    reasoning: "A product brand",
                    isNonBrand: false,
                    nonBrandReason: null,
                    brand_name: "My Brand",
                    slug_generated: "my-brand",
                    confidence: "high",
                  },
                  {
                    slug: "some-reseller",
                    reasoning: "This is a reseller",
                    isNonBrand: true,
                    nonBrandReason: "代購 (reseller)",
                    brand_name: null,
                    slug_generated: "some-reseller",
                    confidence: "high",
                  },
                ],
              }),
            },
          },
        ],
      }),
    });

    const { results } = await detectBrandsBatch(brands);

    expect(results.size).toBe(2);

    const myBrand = results.get("my-brand");
    expect(myBrand).toBeDefined();
    expect(myBrand!.isNonBrand).toBe(false);
    // Detect prompt no longer asks for category; always null
    expect(myBrand!.categorySlug).toBeNull();
    expect(myBrand!.slug).toBe("my-brand");
    expect(myBrand!.slugGenerated).toBe("my-brand");
    expect(myBrand!.confidence).toBe("high");

    const reseller = results.get("some-reseller");
    expect(reseller).toBeDefined();
    expect(reseller!.isNonBrand).toBe(true);
    expect(reseller!.nonBrandReason).toBe("代購 (reseller)");
    expect(reseller!.slugGenerated).toBe("some-reseller");
  });

  // Content failure, not transport failure: a batch the model answered
  // unusably is still worth retrying one brand at a time. A batch that never
  // reached the provider is not — see the provider-failure test below.
  it("falls back to individual calls when the batch response is unusable", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"not":"an array"}' } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  reasoning: "A product brand",
                  isNonBrand: false,
                  nonBrandReason: null,
                  brand_name: "My Brand",
                  slug_generated: "my-brand",
                  confidence: "high",
                }),
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  reasoning: "This is a reseller",
                  isNonBrand: true,
                  nonBrandReason: "reseller",
                  brand_name: null,
                  slug_generated: "some-reseller",
                  confidence: "high",
                }),
              },
            },
          ],
        }),
      });

    const { results } = await detectBrandsBatch(brands);
    expect(results.size).toBe(2);
  });

  it("chunks brands into batches of 20", async () => {
    const largeBatch: DetectBatchItem[] = Array.from(
      { length: 25 },
      (_, i) => ({
        slug: `brand-${i}`,
        name: `Brand ${i}`,
        description: null,
        website: null,
      }),
    );

    const makeResponse = (count: number) => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: Array.from({ length: count }, (_, i) => ({
                  slug: `brand-${i}`,
                  reasoning: "A brand",
                  isNonBrand: false,
                  nonBrandReason: null,
                  brand_name: `Brand ${i}`,
                  slug_generated: `brand-${i}`,
                  confidence: "medium",
                })),
              }),
            },
          },
        ],
      }),
    });

    mockFetch
      .mockResolvedValueOnce(makeResponse(20))
      .mockResolvedValueOnce(makeResponse(5));

    const { results } = await detectBrandsBatch(largeBatch);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(results.size).toBe(25);
  });

  it("reports a provider failure and skips the per-brand fallback", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // A spent account answers 429 to the batch call and would answer 429 to
    // every single-brand retry too. One call, not one plus twenty.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      clone: () => ({
        json: async () => ({ error: { code: "insufficient_quota" } }),
      }),
      json: async () => ({ error: { code: "insufficient_quota" } }),
      headers: new Headers(),
    });

    const { results, calls } = await detectBrandsBatch(brands);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(results.size).toBe(0);
    expect(calls).toEqual({ attempted: 1, providerFailed: 1 });
  });

  /**
   * DEV-1644 F10. `probeStatic` reads each known URL's <head>; before this the
   * result was collected and dropped, so a live site whose title says what the
   * brand sells never reached the model. Both prompt sites render it — the
   * batch one here, the single-brand retry below.
   */
  it("probe_evidence_reaches_detect_prompt", async () => {
    // Persistent, not `Once`: the assertion is on the REQUEST, and an empty
    // result set is allowed to trigger the per-brand retry without the test
    // caring which path it took.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ results: [] }) } }],
      }),
    });

    await detectBrandsBatch([
      {
        ...brands[0],
        probes: [
          {
            url: "https://mybrand.com",
            title: "My Brand Official Store",
            description: "Handmade soap made in Taipei",
            platform: "shopee",
          },
        ],
      },
    ]);

    const body = JSON.parse(
      (mockFetch.mock.calls[0][1] as { body: string }).body,
    ) as { messages: Array<{ role: string; content: string }> };
    const userMessage = body.messages.find((m) => m.role === "user")?.content;

    expect(userMessage).toContain(
      "探測：My Brand Official Store — Handmade soap made in Taipei (shopee)",
    );
  });

  it("probe_evidence_reaches_the_single_brand_prompt", async () => {
    // The per-brand retry runs on a content failure, so the batch answer is
    // junk and the single call carries the same probe line.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "not json at all" } }],
      }),
    });

    await detectBrandsBatch([
      {
        ...brands[0],
        probes: [{ url: "https://mybrand.com", title: "My Brand Official Store" }],
      },
    ]);

    const singleBody = JSON.parse(
      (mockFetch.mock.calls[1][1] as { body: string }).body,
    ) as { messages: Array<{ role: string; content: string }> };
    const userMessage = singleBody.messages.find(
      (m) => m.role === "user",
    )?.content;

    expect(userMessage).toContain("探測：My Brand Official Store");
  });

  it("does not report a provider failure when the model answers with junk", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    // Content failure, so the per-brand fallback is still worth paying for:
    // the account is alive and a smaller prompt may parse.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "not json at all" } }],
      }),
    });

    const { results, calls } = await detectBrandsBatch(brands);

    // 1 batch chunk + 1 single retry per brand.
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(results.size).toBe(0);
    expect(calls.providerFailed).toBe(0);
    expect(calls.attempted).toBe(3);
  });
});

describe("parseExtractionResult", () => {
  it("extraction parses new fact fields and never returns a category write", () => {
    const parsed = parseExtractionResult(
      JSON.stringify({
        subcategories: ["餐具"],
        city: "台中",
        founding_year: 2015,
        signature_products: ["木製餐盤"],
        where_to_buy: "官網與誠品",
        category_mismatch: true,
      }),
    );
    expect(parsed.city).toBe("taichung");
    expect(parsed.foundingYear).toBe(2015);
    expect(parsed.categoryMismatch).toBe(true);
    expect("category" in parsed).toBe(false);
  });
});

describe("structured output schemas", () => {
  it("detect_schema_matches_parser_fields", () => {
    // detectSingleShape must contain every field that the detect parser reads
    const shapeKeys = Object.keys(detectSingleShape.shape);
    const requiredFields = [
      "reasoning",
      "isNonBrand",
      "nonBrandReason",
      "brand_name",
      "slug_generated",
      "confidence",
    ];
    for (const field of requiredFields) {
      expect(shapeKeys).toContain(field);
    }

    // Batch shape wraps single fields in { results: [...] }
    const batchShapeKeys = Object.keys(detectBatchShape.shape);
    expect(batchShapeKeys).toContain("results");
  });

  it("classify_schema_has_enum_categories", () => {
    // classifySingleShape must include a category field with L1 slugs
    const shapeKeys = Object.keys(classifySingleShape.shape);
    expect(shapeKeys).toContain("category");

    const expectedSlugs = L1_CATEGORIES.map((c) => c.slug);
    expect(classifySingleShape.shape.category.options).toEqual(expectedSlugs);

    // Batch shape wraps in { results: [...] }
    const batchShapeKeys = Object.keys(classifyBatchShape.shape);
    expect(batchShapeKeys).toContain("results");
  });

  it("batch_triage_response_unwraps_results", async () => {
    // parseTriageResponse must handle { results: [...] } wrapper from
    // structured output
    mockFetch.mockClear();
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    const testBrands: DetectBatchItem[] = [
      {
        slug: "test-brand",
        name: "Test Brand",
        description: "A test brand",
        website: null,
      },
    ];

    // Model returns { results: [...] } wrapper
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [
                  {
                    slug: "test-brand",
                    reasoning: "Clearly a product brand",
                    isNonBrand: false,
                    nonBrandReason: null,
                    brand_name: "Test Brand",
                    slug_generated: "test-brand",
                    confidence: "high" as const,
                  },
                ],
              }),
            },
          },
        ],
      }),
    });

    const { results } = await detectBrandsBatch(testBrands);
    expect(results.size).toBe(1);
    expect(results.get("test-brand")!.isNonBrand).toBe(false);

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("batch_classification_unwraps_results", async () => {
    // parseBatchClassification must handle { results: [...] } wrapper
    // We test via the public classifyCategoryBatch function
    const { classifyCategoryBatch } = await import("../category-classifier");

    mockFetch.mockClear();
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                results: [
                  {
                    slug: "test-brand",
                    reasoning: "Home goods brand",
                    category: "home",
                    confidence: "high",
                  },
                ],
              }),
            },
          },
        ],
      }),
    });

    const { results } = await classifyCategoryBatch([
      {
        slug: "test-brand",
        name: "Test Brand",
        description: "Sells home goods",
      },
    ]);
    expect(results.size).toBe(1);
    expect(results.get("test-brand")!.categorySlug).toBe("home");

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("audit context carries prompt meta from fetchLangfusePromptWithMeta", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ results: [{ slug: "test-brand", reasoning: "test", isNonBrand: false, nonBrandReason: null, brand_name: "Test", slug_generated: "test-brand", confidence: "high" }] }) } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    await detectBrandsBatch([{ slug: "test-brand", name: "Test", description: null, website: null }]);

    const _body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const { fetchLangfusePromptWithMeta } = await import("@/lib/langfuse/prompt");
    expect(fetchLangfusePromptWithMeta).toHaveBeenCalled();

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
