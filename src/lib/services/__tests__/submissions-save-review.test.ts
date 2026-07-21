import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRow = {
  id: "submission-1",
  brand_id: null,
  intent: "recommend",
  brand_name: "Original Brand",
  submitter_email: "test@example.com",
  submitter_name: null,
  description: null,
  website_url: null,
  hero_image_url: null,
  social_instagram: null,
  social_threads: null,
  social_facebook: null,
  purchase_website: null,
  purchase_pinkoi: null,
  purchase_shopee: null,
  other_urls: null,
  suggested_tags: null,
  status: "pending",
  reviewer_notes: null,
  submitted_at: "2024-01-01T00:00:00Z",
  reviewed_at: null,
  reviewed_by: null,
  pdpa_consent_at: null,
  validation_status: null,
  validation_errors: null,
  notified_at: null,
  is_brand_owner: false,
  source_attribution: null,
  product_type_note: null,
  enriched_data: null,
  owner_data: null,
  review_overrides: null,
  base_brand_data: null,
  base_brand_updated_at: null,
  refresh_requested_by: null,
};

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: mocks.createServiceClient,
}));

import { saveSubmissionReview } from "../submissions";

describe("saveSubmissionReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
    };
    mocks.from.mockReturnValue(chain);
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.createServiceClient.mockReturnValue({
      from: mocks.from,
      rpc: mocks.rpc,
    });
  });

  it("saves one normalized field snapshot and ordered image selection", async () => {
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
      }),
      p_submission_id: "submission-1",
    });
  });
});
