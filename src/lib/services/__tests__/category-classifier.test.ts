import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  parseExtractionResult,
  detectBrandsBatch,
  type DetectBatchItem,
  type DetectResult,
} from "../category-classifier";

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
              content: JSON.stringify([
                {
                  slug: "my-brand",
                  isNonBrand: false,
                  nonBrandReason: null,
                  brand_name: "My Brand",
                  slug_generated: "my-brand",
                  confidence: "high",
                },
                {
                  slug: "some-reseller",
                  isNonBrand: true,
                  nonBrandReason: "代購 (reseller)",
                  slug_generated: "some-reseller",
                  confidence: "high",
                },
              ]),
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
              content: JSON.stringify([
                {
                  slug: "my-brand",
                  isNonBrand: false,
                  nonBrandReason: null,
                  slug_generated: "my-brand",
                  category: "beauty",
                  confidence: "high",
                },
                {
                  slug: "some-reseller",
                  isNonBrand: true,
                  nonBrandReason: "代購 (reseller)",
                  slug_generated: "some-reseller",
                  category: null,
                  confidence: "high",
                },
              ]),
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
    expect(myBrand!.categorySlug).toBe("beauty");
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
                  isNonBrand: false,
                  slug_generated: "my-brand",
                  category: "beauty",
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
                  isNonBrand: true,
                  nonBrandReason: "reseller",
                  slug_generated: "some-reseller",
                  category: null,
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
              content: JSON.stringify(
                Array.from({ length: count }, (_, i) => ({
                  slug: `brand-${i}`,
                  isNonBrand: false,
                  slug_generated: `brand-${i}`,
                  category: "crafts",
                  confidence: "medium",
                })),
              ),
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
        price_range: 2,
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
