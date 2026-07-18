import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => mocks,
}));

import { saveSubmissionReview } from "../submissions";

describe("saveSubmissionReview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves one normalized field snapshot and ordered image selection", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await saveSubmissionReview("submission-1", {
      name: "品牌名稱",
      description: "中文介紹",
      descriptionEn: "English description",
      blurb: "品牌摘要",
      blurbEn: "Brand blurb",
      city: "台中",
      categoryAttributes: { material: "木" },
      reputationSummary: { text: "評價良好" },
      retailLocations: [{ name: "台中店" }],
      mitEvidence: { verified_source: "registry" },
      siteContent: null,
      foundingYear: 2018,
      heroImageUrl: "https://cdn.example.com/hero.webp",
      productType: "crafts",
      priceRange: 2,
      productTags: ["木工"],
      productTagsEn: ["Woodwork"],
      websiteUrl: "https://brand.example.com",
      socialInstagram: null,
      socialThreads: null,
      socialFacebook: null,
      purchaseWebsite: "https://brand.example.com",
      purchasePinkoi: null,
      purchaseShopee: null,
      otherUrls: [],
      images: [
        { id: "hero", isHero: true, sortOrder: 0 },
        { id: "detail", isHero: false, sortOrder: 1 },
      ],
    });

    expect(mocks.rpc).toHaveBeenCalledWith("save_submission_review", {
      p_images: [
        { id: "hero", is_hero: true, sort_order: 0 },
        { id: "detail", is_hero: false, sort_order: 1 },
      ],
      p_review_data: expect.objectContaining({
        name: "品牌名稱",
        description: "中文介紹",
        description_en: "English description",
        product_type: "crafts",
        product_tags: ["木工"],
        price_range: 2,
        purchase_website: "https://brand.example.com",
        other_urls: [],
      }),
      p_submission_id: "submission-1",
    });
  });
});
