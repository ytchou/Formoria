import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  parseExtractionResult,
  detectBrand,
  type DetectItem,
  detectSingleShape,
} from "../category-classifier";

const promptMeta = { name: "detect", version: 2, source: "langfuse" as const };
vi.mock("@/lib/langfuse/prompt", () => ({
  fetchLangfusePrompt: vi.fn((_n: string) => Promise.resolve("mock-prompt")),
  fetchLangfusePromptWithMeta: vi.fn((_n: string) =>
    Promise.resolve({ text: "mock-prompt", prompt: promptMeta }),
  ),
}));

const mockFetch = vi.fn();

function modelAnswer(content: string) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function requestUserMessage(callIndex = 0): string | undefined {
  const body = JSON.parse(
    (mockFetch.mock.calls[callIndex][1] as { body: string }).body,
  ) as { messages: Array<{ role: string; content: string }> };
  return body.messages.find((m) => m.role === "user")?.content;
}

describe("detectBrand", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const brand: DetectItem = {
    slug: "my-brand",
    name: "My Brand",
    description: "Handmade soap",
    website: "https://mybrand.com",
  };

  it("maps a single detect answer that omits categorySlug", async () => {
    // The detect prompt no longer asks for a category, so the key is absent.
    // The triage result must still carry the non-brand gate and the name/slug.
    mockFetch.mockResolvedValueOnce(
      modelAnswer(
        JSON.stringify({
          reasoning: "Clearly a product brand",
          isNonBrand: false,
          nonBrandReason: null,
          brand_name: " My Brand ",
          slug_generated: "my-brand",
          confidence: "high",
        }),
      ),
    );

    const { value, calls } = await detectBrand(brand);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(calls).toEqual({ attempted: 1, providerFailed: 0 });
    expect(value).toEqual({
      isNonBrand: false,
      nonBrandReason: null,
      brandName: "My Brand",
      slug: "my-brand",
      slugGenerated: "my-brand",
      categorySlug: null,
      confidence: "high",
    });
  });

  it("carries a non-brand verdict and its reason", async () => {
    mockFetch.mockResolvedValueOnce(
      modelAnswer(
        JSON.stringify({
          reasoning: "This is a reseller",
          isNonBrand: true,
          nonBrandReason: "代購 (reseller)",
          brand_name: null,
          slug_generated: null,
          confidence: "high",
        }),
      ),
    );

    const { value } = await detectBrand({
      slug: "some-reseller",
      name: "代購小舖",
      description: null,
      website: null,
    });

    expect(value?.isNonBrand).toBe(true);
    expect(value?.nonBrandReason).toBe("代購 (reseller)");
    expect(value?.brandName).toBeNull();
    expect(value?.slug).toBe("some-reseller");
  });

  it("reports a content failure, not a provider failure, when the model answers with junk", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(modelAnswer("not json at all"));

    const { value, calls } = await detectBrand(brand);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(value).toBeNull();
    expect(calls).toEqual({ attempted: 1, providerFailed: 0 });
  });

  it("rejects a batch-shaped answer instead of reading its first entry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(
      modelAnswer(
        JSON.stringify({
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
          ],
        }),
      ),
    );

    const { value, calls } = await detectBrand(brand);

    expect(value).toBeNull();
    expect(calls).toEqual({ attempted: 1, providerFailed: 0 });
  });

  it("reports a provider failure on a non-2xx answer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      clone: () => ({
        json: async () => ({ error: { code: "insufficient_quota" } }),
      }),
      json: async () => ({ error: { code: "insufficient_quota" } }),
      headers: new Headers(),
    });

    const { value, calls } = await detectBrand(brand);

    expect(value).toBeNull();
    expect(calls).toEqual({ attempted: 1, providerFailed: 1 });
  });

  it("issues no call without an API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    const { value, calls } = await detectBrand(brand);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(value).toBeNull();
    expect(calls).toEqual({ attempted: 0, providerFailed: 0 });
  });

  /**
   * DEV-1644 F10. `probeStatic` reads each known URL's <head>; before this the
   * result was collected and dropped, so a live site whose title says what the
   * brand sells never reached the model.
   */
  it("probe_evidence_reaches_detect_prompt", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch.mockResolvedValue(modelAnswer("{}"));

    await detectBrand({
      ...brand,
      snippets: ["handmade soap in Taipei"],
      probes: [
        {
          url: "https://mybrand.com",
          title: "My Brand Official Store",
          description: "Handmade soap made in Taipei",
          platform: "shopee",
        },
      ],
    });

    const userMessage = requestUserMessage();
    expect(userMessage).toContain("品牌 slug：my-brand");
    expect(userMessage).toContain("搜尋摘要：handmade soap in Taipei");
    expect(userMessage).toContain(
      "探測：My Brand Official Store — Handmade soap made in Taipei (shopee)",
    );
  });

  it("audit context carries prompt meta from fetchLangfusePromptWithMeta", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(modelAnswer("{}"));

    await detectBrand(brand);

    const { fetchLangfusePromptWithMeta } = await import("@/lib/langfuse/prompt");
    expect(fetchLangfusePromptWithMeta).toHaveBeenCalledWith("detect");
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
  });
});
