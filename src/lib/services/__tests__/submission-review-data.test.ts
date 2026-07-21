import { describe, expect, it } from "vitest";
import {
  buildSubmissionReviewData,
  getSubmissionReviewCompleteness,
  normalizeSubmissionReviewImages,
  type SubmissionReviewImage,
} from "../submissions";

const baseSubmission = {
  brandName: "Original Brand",
  description: "Original description",
  websiteUrl: "https://original.example.com",
  heroImageUrl: "https://cdn.example.com/hero.webp",
  socialInstagram: "https://instagram.com/original",
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: null,
  purchasePinkoi: null,
  purchaseShopee: null,
  otherUrls: [{ label: "Stockist", url: "https://stockist.example.com" }],
  suggestedTags: {
    values: ["手工皂"],
    productType: "beauty",
  },
};

const activeImages: SubmissionReviewImage[] = [
  {
    id: "hero",
    submissionId: "submission-1",
    storagePath: "submissions/submission-1/hero.webp",
    url: "https://cdn.example.com/hero.webp",
    source: "admin",
    status: "active",
    sortOrder: 0,
    altZh: null,
    altEn: null,
    width: 1200,
    height: 900,
    originBrandImageId: null,
  },
  {
    id: "detail",
    submissionId: "submission-1",
    storagePath: "submissions/submission-1/detail.webp",
    url: "https://cdn.example.com/detail.webp",
    source: "admin",
    status: "active",
    sortOrder: 1,
    altZh: null,
    altEn: null,
    width: 1200,
    height: 900,
    originBrandImageId: null,
  },
];

describe("buildSubmissionReviewData", () => {
  it("shows populated enrichment in the normalized review data", () => {
    const reviewData = buildSubmissionReviewData(baseSubmission, {
      name: "Enriched Brand",
      description: "豐富後的中文介紹",
      descriptionEn: "Enriched English description",
      productType: "crafts",
      productTags: ["木工", "家飾"],
      productTagsEn: ["Woodwork", "Home decor"],
      priceRange: 2,
      city: "台中",
      foundingYear: 2018,
      purchaseWebsite: "https://enriched.example.com",
      mitEvidence: { verified_source: "registry" },
      reputationSummary: { text: "評價良好" },
      retailLocations: [{ name: "台中店" }],
    }, activeImages);

    expect(reviewData).toMatchObject({
      name: "Enriched Brand",
      description: "豐富後的中文介紹",
      descriptionEn: "Enriched English description",
      productType: "crafts",
      productTags: ["木工", "家飾"],
      productTagsEn: ["Woodwork", "Home decor"],
      priceRange: 2,
      city: "台中",
      foundingYear: 2018,
      websiteUrl: "https://enriched.example.com",
      heroImageUrl: "https://cdn.example.com/hero.webp",
      mitEvidence: { verified_source: "registry" },
      reputationSummary: { text: "評價良好" },
      retailLocations: [{ name: "台中店" }],
    });
  });

  it("does not let blank enrichment overwrite populated submission data", () => {
    const reviewData = buildSubmissionReviewData(baseSubmission, {
      name: "  ",
      description: "",
      heroImageUrl: " ",
      productType: "",
      productTags: [],
      purchaseWebsite: "",
      socialInstagram: "",
      otherUrls: [],
    }, activeImages);

    expect(reviewData).toMatchObject({
      name: "Original Brand",
      description: "Original description",
      productType: "beauty",
      productTags: ["手工皂"],
      websiteUrl: "https://original.example.com",
      heroImageUrl: "https://cdn.example.com/hero.webp",
      socialInstagram: "https://instagram.com/original",
      otherUrls: [
        { label: "Stockist", url: "https://stockist.example.com" },
      ],
    });
  });
});

describe("getSubmissionReviewCompleteness", () => {
  function completeData() {
    return buildSubmissionReviewData(baseSubmission, {
      productType: "beauty",
      productTags: ["手工皂"],
      priceRange: 2,
    }, activeImages);
  }

  it("accepts a complete persisted review", () => {
    expect(
      getSubmissionReviewCompleteness(
        completeData(),
        activeImages,
        "succeeded",
      ),
    ).toEqual({ complete: true, missingFields: [] });
  });

  it.each([
    ["description", { description: "" }],
    ["productType", { productType: "unknown-category" }],
    ["productTags", { productTags: [] }],
    ["productTags", { productTags: ["一", "二", "三", "四", "五", "六"] }],
    ["priceRange", { priceRange: 4 }],
    ["website", { websiteUrl: "javascript:alert(1)" }],
  ] as const)("reports a missing %s requirement", (missingField, patch) => {
    const result = getSubmissionReviewCompleteness(
      { ...completeData(), ...patch } as ReturnType<typeof completeData>,
      activeImages,
      "succeeded",
    );

    expect(result.complete).toBe(false);
    expect(result.missingFields).toContain(missingField);
  });

  it("requires a hero and an additional distinct active image", () => {
    const duplicateAndInactiveImages: SubmissionReviewImage[] = [
      activeImages[0]!,
      { ...activeImages[1]!, id: "duplicate", url: activeImages[0]!.url },
      { ...activeImages[1]!, id: "draft", status: "draft" },
      { ...activeImages[1]!, id: "rejected", status: "rejected" },
    ];

    const result = getSubmissionReviewCompleteness(
      completeData(),
      duplicateAndInactiveImages,
      "succeeded",
    );

    expect(result.missingFields).toContain("additionalImage");
    expect(result.missingFields).not.toContain("heroImage");
  });

  it("requires the latest enrichment target to have succeeded", () => {
    const result = getSubmissionReviewCompleteness(
      completeData(),
      activeImages,
      "failed",
    );

    expect(result.missingFields).toContain("successfulEnrichment");
  });
});

describe("normalizeSubmissionReviewImages", () => {
  it("sorts active images first and removes duplicate URLs", () => {
    expect(
      normalizeSubmissionReviewImages([
        { ...activeImages[1]!, sortOrder: 2 },
        { ...activeImages[0]!, sortOrder: 0 },
        { ...activeImages[1]!, id: "duplicate", sortOrder: 1 },
      ]).map((image) => image.id),
    ).toEqual(["hero", "duplicate"]);
  });
});
