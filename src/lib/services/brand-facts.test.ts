import { describe, expect, it, vi } from "vitest";
import {
  parseBrandFactsResult,
  factsShape,
  extractBrandFacts,
  researchFoundingFacts,
} from "./brand-facts";
import { L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import { fetchLangfusePrompt } from "@/lib/langfuse/prompt";
import { createProfiledOpenAIClient } from "./llm-audit";

vi.mock("@/lib/langfuse/prompt", () => ({
  fetchLangfusePrompt: vi.fn().mockImplementation(
    (_name: string, fallback: string) => Promise.resolve(fallback),
  ),
}));

vi.mock("./llm-audit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./llm-audit")>()),
  createProfiledOpenAIClient: vi.fn(),
}));

/**
 * These cases lived in `description-rewrite.test.ts` until the mega-call was
 * split: every field they cover is now produced by the facts call.
 */
function makeTagFixture(
  subcategories: string[],
  subcategories_en: string[],
): string {
  return JSON.stringify({
    subcategories,
    subcategories_en,
    city: null,
    founding_year: null,
  });
}

describe("parseBrandFactsResult", () => {
  it("returns empty facts when the LLM response is not valid JSON", () => {
    const result = parseBrandFactsResult(
      "抱歉，我無法解析，但這裡有超過二十個字元的原始輸出內容",
    );
    expect(result.city).toBeNull();
    expect(result.subcategories).toEqual([]);
  });

  it("maps free-text city names to DB slugs", () => {
    const json = JSON.stringify({
      subcategories: [],
      subcategories_en: [],
      city: "台北",
      founding_year: null,
    });
    expect(parseBrandFactsResult(json).city).toBe("taipei");
  });

  it("returns null city when the value cannot be mapped to a valid slug", () => {
    const json = JSON.stringify({
      subcategories: [],
      subcategories_en: [],
      city: "somewhere unknown",
      founding_year: null,
    });
    expect(parseBrandFactsResult(json).city).toBeNull();
  });

  it("normalizes subcategories against the vocabulary and collapses variants", () => {
    const json = makeTagFixture(
      ["側背包", "口金零錢包", "口金夾"],
      ["crossbody", "clasp coin purse", "clasp wallet"],
    );
    const result = parseBrandFactsResult(json);
    // '側背包' is an alias for crossbody-bags; '口金夾' dedupes to the same slug
    // as '口金零錢包'. Storage is slugs since DEV-1510.
    expect(result.subcategories).toEqual([
      "crossbody-bags",
      "clasp-frame-bags",
    ]);
    expect(result.subcategoriesEn).toEqual([
      "Crossbody Bags",
      "Clasp-Frame Bags",
    ]);
  });

  it("keeps a single normalized tag (min-1 gate)", () => {
    const json = makeTagFixture(["口金零錢包", "口金夾"], ["a", "b"]);
    const result = parseBrandFactsResult(json);
    // Both collapse to the same slug → one canonical subcategory
    // Old min-2 gate would have dropped it; min-1 gate preserves it
    expect(result.subcategories).toEqual(["clasp-frame-bags"]);
    expect(result.subcategoriesEn).toEqual(["Clasp-Frame Bags"]);
  });

  it("drops a term the closed vocabulary does not know, and records it", () => {
    const json = makeTagFixture(["藍鵲系列襪子"], ["bluebird series socks"]);
    const result = parseBrandFactsResult(json);
    // No novel escape hatch since DEV-1510: the model's term either resolves to
    // a node or is rejected — and every rejection is logged, because that log is
    // the only remaining signal that the vocabulary has a gap.
    expect(result.subcategories).toEqual([]);
    expect(result.rejected).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subcategory: "藍鵲系列襪子",
          reason: "unknown-term",
        }),
      ]),
    );
  });

});

describe("parseBrandFactsResult — listing verdict", () => {
  const withListing = (listing: unknown): string =>
    JSON.stringify({
      subcategories: [],
      subcategories_en: [],
      city: "台北",
      founding_year: null,
      ...(listing === undefined ? {} : { listing }),
    });

  it("parses a valid listing object", () => {
    const result = parseBrandFactsResult(
      withListing({
        verdict: "reject",
        reason: "沒有自有商品，屬於代購",
        taiwan_connection: "unclear",
        has_own_products: false,
        has_purchase_channel: true,
      }),
    );

    expect(result.listing).toEqual({
      verdict: "reject",
      reason: "沒有自有商品，屬於代購",
      taiwanConnection: "unclear",
      hasOwnProducts: false,
      hasPurchaseChannel: true,
    });
  });

  it("leaves the rest of the extraction valid when listing is absent", () => {
    const result = parseBrandFactsResult(withListing(undefined));

    expect(result.listing).toBeUndefined();
    // The listing verdict is a secondary output — a missing one cannot void the facts.
    expect(result.city).toBe("taipei");
  });

  it("degrades an unknown verdict to undefined without throwing", () => {
    const result = parseBrandFactsResult(
      withListing({
        verdict: "maybe",
        reason: "unsure",
        taiwan_connection: "moon",
      }),
    );

    expect(result.listing).toBeUndefined();
    expect(result.city).toBe("taipei");
  });

  it("degrades a malformed listing value to undefined without throwing", () => {
    expect(
      parseBrandFactsResult(withListing("reject")).listing,
    ).toBeUndefined();
    expect(
      parseBrandFactsResult(withListing(["reject"])).listing,
    ).toBeUndefined();
    expect(parseBrandFactsResult(withListing(null)).listing).toBeUndefined();
  });

  it("keeps a valid verdict while nulling only the unrecognised sub-fields", () => {
    const result = parseBrandFactsResult(
      withListing({
        verdict: "list",
        taiwan_connection: "imported",
        has_own_products: "yes",
      }),
    );

    expect(result.listing).toEqual({
      verdict: "list",
      reason: null,
      taiwanConnection: null,
      hasOwnProducts: null,
      hasPurchaseChannel: null,
    });
  });
});

describe("parseBrandFactsResult — category", () => {
  const withCategory = (categorySlug: unknown): string =>
    JSON.stringify({
      subcategories: [],
      subcategories_en: [],
      city: "台北",
      founding_year: null,
      ...(categorySlug === undefined ? {} : { category: categorySlug }),
    });

  it("parses a valid L1 category slug", () => {
    expect(parseBrandFactsResult(withCategory("beauty")).categorySlug).toBe(
      "beauty",
    );
  });

  it("leaves the extraction valid when category is absent", () => {
    const result = parseBrandFactsResult(withCategory(undefined));

    expect(result.categorySlug).toBeUndefined();
    expect(result.city).toBe("taipei");
  });

  it("degrades an unrecognised category to undefined without voiding the facts", () => {
    for (const value of ["skincare", "美妝", "", 42, null, ["beauty"]]) {
      const result = parseBrandFactsResult(withCategory(value));
      expect(
        result.categorySlug,
        `value: ${JSON.stringify(value)}`,
      ).toBeUndefined();
      expect(result.city).toBe("taipei");
    }
  });
});

describe("FACTS_SCHEMA", () => {
  it("has category enum matching L1_CATEGORIES slugs", () => {
    const expectedSlugs = L1_CATEGORIES.map((c) => c.slug);
    // The Zod enum's `.options` carries the allowed string values
    const categoryOptions = factsShape.shape.category.unwrap().options;
    expect(categoryOptions).toEqual(expect.arrayContaining(expectedSlugs));
    // Nullable — the outer wrapper is z.nullable()
    expect(factsShape.shape.category.isNullable()).toBe(true);
  });

  it("has listing.reasoning property", () => {
    const listingKeys = Object.keys(factsShape.shape.listing.shape);
    expect(listingKeys).toContain("reasoning");
  });

  it("passes 3 variable keys to fetchLangfusePrompt", async () => {
    const chat = vi.fn().mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {},
      content: JSON.stringify({
        category: "home",
        subcategories: [],
        material: [],
        city: null,
        founding_year: null,
        listing: { reasoning: "test", verdict: "list", reason: "", taiwan_connection: "created", has_own_products: true, has_purchase_channel: true },
      }),
    });
    vi.mocked(createProfiledOpenAIClient).mockReturnValue({ chat } as never);
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    await extractBrandFacts(
      "TestBrand",
      "some content",
      { jobId: "job-1", target: { type: "brand", id: "brand-1" } },
      { summary: {} },
    );

    expect(fetchLangfusePrompt).toHaveBeenCalledWith(
      "brand-facts",
      expect.any(String),
      expect.objectContaining({
        category_list: expect.any(String),
        subcategory_vocab_block: expect.any(String),
        material_vocab_block: expect.any(String),
      }),
    );
  });
});

describe("researchFoundingFacts", () => {
  const sources = [
    {
      url: "https://harbor-form.tw/about",
      text: "Harbor Form was founded in Taipei in 2019.",
      sourceType: "first-party" as const,
      reputable: true,
      fetched: true,
    },
  ];

  it("uses a separate verification call before accepting an extracted fact", async () => {
    const extractionChat = vi.fn().mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {},
      content: JSON.stringify({
        claims: [
          {
            field: "city",
            value: "taipei",
            cited_url: sources[0].url,
            exact_excerpt: sources[0].text,
            location_context: "founding",
          },
        ],
      }),
    });
    const verificationChat = vi.fn().mockResolvedValue({
      response: { ok: true, status: 200 },
      data: {},
      content: JSON.stringify({
        results: [{ claim_index: 0, passed: true, reason: null }],
      }),
    });
    vi.mocked(createProfiledOpenAIClient)
      .mockReturnValueOnce({ chat: extractionChat } as never)
      .mockReturnValueOnce({ chat: verificationChat } as never);
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    const result = await researchFoundingFacts("Harbor Form", sources, {
      jobId: "job-1",
      target: { type: "brand", id: "brand-1" },
    });

    expect(result?.city.value).toBe("taipei");
    expect(result?.city.confidence).toBe("high");
    expect(extractionChat).toHaveBeenCalledTimes(1);
    expect(verificationChat).toHaveBeenCalledTimes(1);
    expect(createProfiledOpenAIClient).toHaveBeenCalledWith(
      "foundingFactsVerify",
      expect.objectContaining({ phase: "founding_facts_verify" }),
      { apiKey: "test-key" },
    );
  });

  it("rejects a proposal when the verification call does not support it", async () => {
    vi.mocked(createProfiledOpenAIClient)
      .mockReturnValueOnce({
        chat: vi.fn().mockResolvedValue({
          response: { ok: true, status: 200 },
          data: {},
          content: JSON.stringify({
            claims: [
              {
                field: "city",
                value: "taipei",
                cited_url: sources[0].url,
                exact_excerpt: sources[0].text,
                location_context: "founding",
              },
            ],
          }),
        }),
      } as never)
      .mockReturnValueOnce({
        chat: vi.fn().mockResolvedValue({
          response: { ok: true, status: 200 },
          data: {},
          content: JSON.stringify({
            results: [
              {
                claim_index: 0,
                passed: false,
                reason: "The excerpt does not describe founding.",
              },
            ],
          }),
        }),
      } as never);
    vi.stubEnv("OPENAI_API_KEY", "test-key");

    const result = await researchFoundingFacts("Harbor Form", sources, {
      target: { type: "brand", id: "brand-1" },
    });

    expect(result?.city.value).toBeNull();
    expect(result?.city.rejections).toContain("verification-failed");
  });
});
