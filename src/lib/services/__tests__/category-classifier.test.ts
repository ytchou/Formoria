import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  parseExtractionResult,
  detectBrand,
  type DetectItem,
  detectSingleShape,
  renderDetectUserMessage,
  MAX_PROBE_URLS,
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
   * brand sells never reached the model. DEV-1894 adds search results with
   * ownership tags, the submitted website and failed probes.
   */
  it("probe_evidence_reaches_detect_prompt", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch.mockResolvedValue(modelAnswer("{}"));

    await detectBrand({
      ...brand,
      submittedWebsite: "https://mybrand.tw",
      results: [
        {
          title: "My Brand",
          snippet: "handmade soap in Taipei",
          host: "mybrand.com",
          match: "site",
        },
      ],
      probes: [
        {
          url: "https://mybrand.com",
          title: "My Brand Official Store",
          description: "Handmade soap made in Taipei",
          platform: "shopee",
        },
        { url: "https://mybrand.tw/", status: 404 },
      ],
    });

    const userMessage = requestUserMessage();
    expect(userMessage).toContain("品牌 slug：my-brand");
    expect(userMessage).toContain("提交網址：https://mybrand.tw");
    expect(userMessage).toContain(
      "搜尋結果：My Brand — handmade soap in Taipei（mybrand.com，官網）",
    );
    expect(userMessage).toContain(
      "探測：My Brand Official Store — Handmade soap made in Taipei (shopee)",
    );
    expect(userMessage).toContain("探測：mybrand.tw — 無法連線（HTTP 404）");
  });

  it("detect_call_sends_rendered_message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch.mockResolvedValue(modelAnswer("{}"));
    const item: DetectItem = {
      ...brand,
      submittedWebsite: null,
      results: [
        { title: "Result", snippet: "text", host: "example.com", match: null },
      ],
      probes: [{ url: "https://mybrand.com", title: "Home" }],
    };

    await detectBrand(item);

    expect(requestUserMessage()).toBe(renderDetectUserMessage(item));
  });

  it("audit context carries prompt meta from fetchLangfusePromptWithMeta", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockFetch.mockResolvedValueOnce(modelAnswer("{}"));

    await detectBrand(brand);

    const { fetchLangfusePromptWithMeta } = await import("@/lib/langfuse/prompt");
    expect(fetchLangfusePromptWithMeta).toHaveBeenCalledWith("detect");
  });
});

describe("renderDetectUserMessage", () => {
  const base: DetectItem = {
    slug: "my-brand",
    name: "My Brand",
    description: null,
    website: null,
  };

  it("render_full_item_exact", () => {
    const message = renderDetectUserMessage({
      slug: "my-brand",
      name: "My Brand",
      description: "Handmade soap",
      website: "https://shop.mybrand.com",
      submittedWebsite: "https://mybrand.com",
      results: [
        {
          title: "My Brand Official",
          snippet: "Handmade soap from Taipei",
          host: "mybrand.com",
          match: "site",
        },
        {
          title: "My Brand (@mybrand)",
          snippet: "1,234 followers",
          host: "instagram.com",
          match: "instagram",
        },
        { title: "Soap roundup", host: "blog.example.com", match: null },
      ],
      probes: [
        { url: "https://mybrand.com/gone", status: 404 },
        {
          url: "https://shop.mybrand.com",
          title: "My Brand Shop",
          description: "Soap and candles",
          platform: "shopline",
          instagramFollowers: 1234,
        },
      ],
    });

    expect(message).toBe(
      [
        "品牌 slug：my-brand",
        "品牌名稱：My Brand",
        "描述：Handmade soap",
        "網站：https://shop.mybrand.com",
        "提交網址：https://mybrand.com",
        "搜尋結果：My Brand Official — Handmade soap from Taipei（mybrand.com，官網）",
        "搜尋結果：My Brand (@mybrand) — 1,234 followers（instagram.com，IG 相符）",
        "搜尋結果：Soap roundup（blog.example.com）",
        "探測：My Brand Shop — Soap and candles (shopline)，IG 追蹤者 1,234",
        "探測：mybrand.com — 無法連線（HTTP 404）",
      ].join("\n"),
    );
  });

  it("render_missing_fields_use_无", () => {
    const withEmpty = renderDetectUserMessage({
      ...base,
      submittedWebsite: null,
      results: [],
      probes: [],
    });
    const withAbsent = renderDetectUserMessage(base);

    for (const message of [withEmpty, withAbsent]) {
      expect(message).toBe(
        [
          "品牌 slug：my-brand",
          "品牌名稱：My Brand",
          "描述：無",
          "網站：無",
          "提交網址：無",
        ].join("\n"),
      );
      expect(message).not.toContain("搜尋結果：");
      expect(message).not.toContain("探測：");
    }
  });

  it("render_caps_results_and_probes", () => {
    const long = "x".repeat(400);
    const message = renderDetectUserMessage({
      ...base,
      results: Array.from({ length: 15 }, (_, i) => ({
        title: `Result ${i}`,
        host: "example.com",
        match: null,
      })),
      probes: Array.from({ length: 8 }, (_, i) => ({
        url: `https://example${i}.com`,
        title: long,
        description: long,
      })),
    });
    const lines = message.split("\n");
    const resultLines = lines.filter((l) => l.startsWith("搜尋結果："));
    const probeLines = lines.filter((l) => l.startsWith("探測："));

    expect(resultLines).toHaveLength(10);
    expect(probeLines).toHaveLength(MAX_PROBE_URLS);
    // The 160-character cap bounds the head text; the platform and follower
    // suffix is appended after it (none here).
    for (const line of probeLines) {
      expect(line.slice("探測：".length).length).toBeLessThanOrEqual(160);
    }
  });

  it("render_long_ig_head_keeps_follower_count", () => {
    const message = renderDetectUserMessage({
      ...base,
      probes: [
        {
          url: "https://www.instagram.com/mybrand/",
          title: "t".repeat(300),
          platform: "instagram",
          instagramFollowers: 1234567,
        },
      ],
    });
    const probeLine = message
      .split("\n")
      .find((l) => l.startsWith("探測："));

    expect(probeLine).toBe(
      `探測：${"t".repeat(160)} (instagram)，IG 追蹤者 1,234,567`,
    );
  });

  it("render_title_less_result_uses_snippet", () => {
    const message = renderDetectUserMessage({
      ...base,
      results: [{ title: "", snippet: "Brand X opens", host: "news.tw", match: "site" }],
    });

    expect(message.split("\n")).toContain("搜尋結果：Brand X opens（news.tw，官網）");
  });

  it("render_reachable_headless_probe_is_not_unreachable", () => {
    const message = renderDetectUserMessage({
      ...base,
      probes: [
        { url: "https://spa.mybrand.com/", status: 200 },
        { url: "https://gone.mybrand.com/", status: 404 },
      ],
    });

    expect(message).not.toContain("HTTP 200");
    expect(message.split("\n")).toContain("探測：gone.mybrand.com — 無法連線（HTTP 404）");
  });

  it("render_unreachable_without_status", () => {
    const message = renderDetectUserMessage({
      ...base,
      probes: [{ url: "https://www.mybrand.com/" }],
    });

    // Probe hosts use the same bare-host form as result hosts.
    expect(message.split("\n")).toContain("探測：mybrand.com — 無法連線");
    expect(message).not.toContain("HTTP");
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
