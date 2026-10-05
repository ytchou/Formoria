import { describe, expect, it } from "vitest";
import {
  enrichedDataFromDb,
  enrichedDataToDb,
  parseSubmissionFaqPatch,
  parseSubmissionStockists,
} from "../enriched-data";
import type { StockistCandidate } from "@/lib/types/stockist";

describe("enrichedDataFromDb", () => {
  it("maps subcategories to subcategories", () => {
    expect(
      enrichedDataFromDb({ subcategories: ["skincare", "refillable"] }),
    ).toEqual({
      subcategories: ["skincare", "refillable"],
    });
  });

  it("maps structured other_urls to OtherUrl values", () => {
    expect(
      enrichedDataFromDb({
        other_urls: [
          { label: "Stockist", url: "https://stockist.example.com" },
        ],
      }),
    ).toEqual({
      otherUrls: [{ label: "Stockist", url: "https://stockist.example.com" }],
    });
  });

  it("preserves expanded enrichment fields", () => {
    expect(
      enrichedDataFromDb({
        description_en: "English description",
        blurb: "品牌摘要",
        blurb_en: "Brand summary",
        city: "台北",
        reputation_summary: { text: "評價良好" },
        site_content: { title: "Official site" },
        founding_year: 2020,
        subcategories_en: ["Handmade"],
      }),
    ).toEqual({
      descriptionEn: "English description",
      blurb: "品牌摘要",
      blurbEn: "Brand summary",
      city: "台北",
      reputationSummary: { text: "評價良好" },
      siteContent: { title: "Official site" },
      foundingYear: 2020,
      subcategoriesEn: ["Handmade"],
    });
  });

  it("ignores the dropped category_attributes key on historical blobs", () => {
    expect(() =>
      enrichedDataFromDb({
        city: "台北",
        category_attributes: { material: "皮革" },
      }),
    ).not.toThrow();
    expect(
      enrichedDataFromDb({
        city: "台北",
        category_attributes: { material: "皮革" },
      }),
    ).toEqual({ city: "台北" });
  });

  it("adapts only a compatible legacy singleton product L2", () => {
    // Catches an old multi-value or cross-L1 proposal being treated as canonical.
    const result = enrichedDataFromDb({
      products: [
        { key: "plate", category: "home", subcategories: ["tableware"] },
        {
          key: "ambiguous",
          category: "home",
          subcategories: ["tableware", "candles"],
        },
        { key: "cross-l1", category: "home", subcategories: ["handbags"] },
      ],
    });

    expect(result.products?.map((product) => product.subcategory)).toEqual([
      "tableware",
      null,
      null,
    ]);
    expect(result.products?.every((product) => !("subcategories" in product))).toBe(
      true,
    );
  });

  it("round-trips a refresh name proposal under its internal JSON key", () => {
    const proposal = {
      value: "劉一刀手工鞋 LID Shoes",
      confidence: "high" as const,
      reason: "官網直接使用雙語品牌名",
      evidence: [
        {
          source: "official_website" as const,
          url: "https://www.lidshoes.com",
          observedName: "劉一刀 手工鞋",
        },
      ],
    };

    const domain = enrichedDataFromDb({ _name_proposal: proposal });

    expect(domain.nameProposal).toEqual(proposal);
    expect(enrichedDataToDb(domain)).toEqual({ _name_proposal: proposal });
  });

  it("keeps a medium proposal that carries no first-party evidence", () => {
    const proposal = {
      value: "AROMASE 艾瑪絲",
      confidence: "medium" as const,
      reason: "尾段是行銷文案",
      evidence: [],
    };

    expect(enrichedDataFromDb({ _name_proposal: proposal }).nameProposal).toEqual(
      proposal,
    );
  });
});

describe("enrichedDataToDb", () => {
  it("maps subcategories to subcategories", () => {
    expect(
      enrichedDataToDb({ subcategories: ["skincare", "refillable"] }),
    ).toEqual({
      subcategories: ["skincare", "refillable"],
    });
  });

  it("writes expanded enrichment fields with database keys", () => {
    expect(
      enrichedDataToDb({
        descriptionEn: "English description",
        blurb: "品牌摘要",
        blurbEn: "Brand summary",
        city: "台北",
        reputationSummary: { text: "評價良好" },
        siteContent: { title: "Official site" },
        foundingYear: 2020,
        subcategoriesEn: ["Handmade"],
      }),
    ).toEqual({
      description_en: "English description",
      blurb: "品牌摘要",
      blurb_en: "Brand summary",
      city: "台北",
      reputation_summary: { text: "評價良好" },
      site_content: { title: "Official site" },
      founding_year: 2020,
      subcategories_en: ["Handmade"],
    });
  });

  it("writes product proposals with only the scalar L2 key", () => {
    // Catches reintroducing the retired product array into new enrichment blobs.
    const result = enrichedDataToDb({
      products: [
        {
          key: "plate",
          nameZh: "手拉坯餐盤",
          category: "home",
          subcategory: "tableware",
          material: ["ceramic"],
          officialUrl: "https://studio.example/products/plate",
          productDescriptionZh: "台灣陶土手拉坯餐盤。",
          sources: [
            {
              url: "https://studio.example/products/plate",
              sourceType: "official",
            },
          ],
        },
      ],
    });

    expect(result.products).toEqual([
      expect.objectContaining({ subcategory: "tableware" }),
    ]);
    expect(
      (result.products as Record<string, unknown>[])[0],
    ).not.toHaveProperty("subcategories");
  });
});

describe("enriched_data.faq blob contract", () => {
  it("faq_round_trips_through_db_adapters", () => {
    const faqBlob = {
      entries: [
        {
          presetId: "main-products",
          position: 0,
          questionZh: "Q",
          answerZh: "A",
          questionEn: "Q-en",
          answerEn: "A-en",
        },
      ],
      explicit: true,
    };

    const domain = enrichedDataFromDb({ faq: faqBlob });

    expect(domain.faq).toEqual(faqBlob);
    expect(enrichedDataToDb(domain)).toEqual({ faq: faqBlob });
  });

  it("faq_malformed_blob_is_dropped_on_read", () => {
    expect(enrichedDataFromDb({ faq: "not-an-object" })).not.toHaveProperty(
      "faq",
    );
    expect(enrichedDataFromDb({ faq: [1, 2] })).not.toHaveProperty("faq");
    expect(enrichedDataFromDb({ faq: { entries: "x" } })).not.toHaveProperty(
      "faq",
    );
  });
});

describe("parseSubmissionFaqPatch", () => {
  it("rejects_unknown_preset_and_bad_position", () => {
    const result = parseSubmissionFaqPatch({
      entries: [
        { presetId: "main-products", position: 0, questionZh: "Q", answerZh: "A" },
        { presetId: "nonexistent-preset", position: 0, questionZh: "Q2", answerZh: "A2" },
        { presetId: "where-to-buy", position: -1, questionZh: "Q3", answerZh: "A3" },
        { presetId: "custom", position: 1.5, questionZh: "Q4", answerZh: "A4" },
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(1);
    expect(result!.entries[0]!.presetId).toBe("main-products");
    expect(result!.explicit).toBe(false);
  });
});

const stockistCandidate = (name: string): StockistCandidate => ({
  name,
  normalizedName: name.toLowerCase(),
  regionLabel: "臺北市",
  address: "臺北市大安區復興南路一段 1 號",
  url: null,
  sourceUrl: "https://example.com/stores",
  locationType: "stockist",
  country: "TW",
  district: "大安區",
  source: "enriched",
  fetchedAt: "2026-10-05T00:00:00.000Z",
});

describe("enriched_data.stockists blob contract", () => {
  it("stockists_round_trip_through_db_adapters", () => {
    const input = {
      stockists: [stockistCandidate("Shop A"), stockistCandidate("Shop B")],
    };

    const stored = enrichedDataToDb(input);
    expect(stored).toEqual({ stockists: input.stockists });
    expect(enrichedDataFromDb(stored)).toEqual(input);
  });

  it("stockists_absent_stays_absent", () => {
    expect(enrichedDataToDb({ description: "x" })).not.toHaveProperty(
      "stockists",
    );
    expect(enrichedDataFromDb({ description: "x" })).not.toHaveProperty(
      "stockists",
    );
  });
});

describe("parseSubmissionStockists", () => {
  it("keeps_valid_candidates_and_drops_malformed_items", () => {
    const valid = stockistCandidate("Shop A");
    const result = parseSubmissionStockists([
      valid,
      { name: "", normalizedName: "x" },
      { name: "   ", normalizedName: "x" },
      { name: "No normalized" },
      { name: 42, normalizedName: "x" },
      null,
      "Shop C",
      [valid],
    ]);

    expect(result).toEqual([valid]);
  });

  it("returns_null_for_non_arrays", () => {
    expect(parseSubmissionStockists(undefined)).toBeNull();
    expect(parseSubmissionStockists(null)).toBeNull();
    expect(parseSubmissionStockists({ name: "Shop A" })).toBeNull();
    expect(parseSubmissionStockists("Shop A")).toBeNull();
  });
});
