import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
  createServiceClient: () => mocks,
}));

import { approveSubmission } from "../submissions";

describe("submission approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes an enriched pending approval through the transactional RPC", async () => {
    const submissionQuery = {
      select: vi.fn(() => submissionQuery),
      eq: vi.fn(() => submissionQuery),
      single: vi.fn().mockResolvedValue({
        data: enrichedPendingSubmission(),
        error: null,
      }),
    };
    const slugQuery = {
      select: vi.fn(() => slugQuery),
      eq: vi.fn(() => slugQuery),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };

    mocks.from.mockImplementation((table: string) =>
      table === "brand_submissions" ? submissionQuery : slugQuery,
    );
    mocks.rpc.mockResolvedValue({
      data: [
        {
          brand_id: "brand-approved",
          submitter_email: "maker@example.com",
          brand_name: "Submitted Brand",
          submitter_name: "林怡君",
          is_brand_owner: false,
          suggested_tags: [],
        },
      ],
      error: null,
    });

    const result = await approveSubmission("submission-1", "reviewer-1");

    expect(mocks.rpc).toHaveBeenCalledWith("approve_submission", {
      p_brand_data: expect.objectContaining({
        name: "Enriched Brand",
        slug: "enriched-brand",
        status: "approved",
        description_en: "Taiwanese handmade skincare brand",
        blurb: "手工保養",
        category_attributes: { material: "botanical" },
        product_tags_en: ["Soap", "Balm"],
      }),
      p_reviewer_id: "reviewer-1",
      p_submission_id: "submission-1",
    });
    expect(result).toEqual({
      brandId: "brand-approved",
      submitterEmail: "maker@example.com",
      brandName: "Submitted Brand",
      submitterName: "林怡君",
      isBrandOwner: false,
    });
    expect(mocks.from).not.toHaveBeenCalledWith("brand_field_state");
  });
});

function enrichedPendingSubmission(): Record<string, unknown> {
  return {
    id: "submission-1",
    brand_id: null,
    brand_name: "Submitted Brand",
    submitter_email: "maker@example.com",
    submitter_name: "林怡君",
    description: "手工保養品牌",
    website_url: "https://submitted.example.com",
    hero_image_url: null,
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
    purchase_website: "https://submitted.example.com/shop",
    purchase_pinkoi: null,
    purchase_shopee: null,
    other_urls: [],
    suggested_tags: [],
    status: "pending",
    reviewer_notes: null,
    submitted_at: "2026-07-14T00:00:00.000Z",
    reviewed_at: null,
    reviewed_by: null,
    pdpa_consent_at: "2026-07-14T00:00:00.000Z",
    validation_status: "valid",
    validation_errors: null,
    notified_at: null,
    is_brand_owner: false,
    intent: "recommend",
    source_attribution: "found_online",
    product_type_note: null,
    enriched_data: {
      name: "Enriched Brand",
      description: "台灣手工保養品品牌",
      hero_image_url: "https://cdn.example.com/hero.jpg",
      product_type: "skincare",
      price_range: 2,
      product_tags: ["soap", "balm"],
      product_tags_en: ["Soap", "Balm"],
      description_en: "Taiwanese handmade skincare brand",
      blurb: "手工保養",
      category_attributes: { material: "botanical" },
    },
  };
}
