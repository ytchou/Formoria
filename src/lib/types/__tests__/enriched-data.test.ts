import { describe, expect, it } from "vitest";
import { enrichedDataFromDb, enrichedDataToDb } from "../enriched-data";

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
