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
    const imagesQuery = submissionImagesQuery();

    mocks.from.mockImplementation((table: string) => {
      if (table === "brand_submissions") return submissionQuery;
      if (table === "submission_images") return imagesQuery;
      return slugQuery;
    });
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

    expect(mocks.rpc).toHaveBeenCalledWith("approve_submission_with_romanized_name", {
      p_brand_data: expect.objectContaining({
        name: "Enriched Brand",
        slug: "submitted-brand",
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

  it("builds approval data from persisted effective fields without blank overwrites", async () => {
    mockApproval({
      ...enrichedPendingSubmission(),
      suggested_tags: { values: ["手工皂"], productType: "beauty" },
      enriched_data: {
        description: " ",
        hero_image_url: "",
        product_type: "",
        product_tags: [],
        purchase_website: "",
      },
    });

    await approveSubmission("submission-1", "reviewer-1");

    expect(mocks.rpc).toHaveBeenCalledWith(
      "approve_submission_with_romanized_name",
      expect.objectContaining({
        p_brand_data: expect.objectContaining({
          description: "手工保養品牌",
          product_type: "beauty",
          product_tags: ["手工皂"],
          purchase_website: "https://submitted.example.com/shop",
          hero_image_url: "https://cdn.example.com/hero.jpg",
        }),
      }),
    );
  });

  it("uses romanized_name for the slug when provided", async () => {
    mockApproval({
      ...enrichedPendingSubmission(),
      brand_name: "鼎泰豐",
      romanized_name: "Din Tai Fung",
      enriched_data: null,
    });

    await approveSubmission("submission-1", "reviewer-1");

    expect(mocks.rpc).toHaveBeenCalledWith(
      "approve_submission_with_romanized_name",
      expect.objectContaining({
        p_brand_data: expect.objectContaining({
          slug: "din-tai-fung",
          romanized_name: "Din Tai Fung",
        }),
      }),
    );
  });

  it("falls back to the Latin run when romanized_name is absent", async () => {
    mockApproval({
      ...enrichedPendingSubmission(),
      brand_name: "愛麗絲傢俱 iliz",
      romanized_name: null,
      enriched_data: null,
    });

    await approveSubmission("submission-1", "reviewer-1");

    expect(mocks.rpc).toHaveBeenCalledWith(
      "approve_submission_with_romanized_name",
      expect.objectContaining({
        p_brand_data: expect.objectContaining({ slug: "iliz" }),
      }),
    );
  });

  it("falls back to Wade-Giles when no Latin name is available", async () => {
    mockApproval({
      ...enrichedPendingSubmission(),
      brand_name: "遇合",
      romanized_name: null,
      enriched_data: null,
    });

    await approveSubmission("submission-1", "reviewer-1");

    expect(mocks.rpc).toHaveBeenCalledWith(
      "approve_submission_with_romanized_name",
      expect.objectContaining({
        p_brand_data: expect.objectContaining({ slug: "yu-ho" }),
      }),
    );
  });
});

function mockApproval(submission: Record<string, unknown>): void {
  const submissionQuery = {
    select: vi.fn(() => submissionQuery),
    eq: vi.fn(() => submissionQuery),
    single: vi.fn().mockResolvedValue({ data: submission, error: null }),
  };
  const slugQuery = {
    select: vi.fn(() => slugQuery),
    eq: vi.fn(() => slugQuery),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  const imagesQuery = submissionImagesQuery();
  mocks.from.mockImplementation((table: string) => {
    if (table === "brand_submissions") return submissionQuery;
    if (table === "submission_images") return imagesQuery;
    return slugQuery;
  });
  mocks.rpc.mockResolvedValue({
    data: [
      {
        brand_id: "brand-approved",
        submitter_email: "maker@example.com",
        brand_name: submission.brand_name,
        submitter_name: "林怡君",
        is_brand_owner: false,
        suggested_tags: [],
      },
    ],
    error: null,
  });
}

function submissionImagesQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn().mockResolvedValue({
      data: [
        {
          id: "hero-image",
          submission_id: "submission-1",
          storage_path: "submissions/submission-1/hero.webp",
          url: "https://cdn.example.com/hero.jpg",
          source: "admin",
          status: "active",
          sort_order: 0,
          alt_zh: null,
          alt_en: null,
          width: 1200,
          height: 900,
        },
        {
          id: "detail-image",
          submission_id: "submission-1",
          storage_path: "submissions/submission-1/detail.webp",
          url: "https://cdn.example.com/detail.jpg",
          source: "admin",
          status: "active",
          sort_order: 1,
          alt_zh: null,
          alt_en: null,
          width: 1200,
          height: 900,
        },
      ],
      error: null,
    }),
  };
  return query;
}

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
