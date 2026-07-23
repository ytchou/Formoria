import { describe, expect, it } from "vitest";
import {
  applySubmissionReviewOverrides,
  buildRefreshSubmissionReviewData,
  buildSubmissionReviewOverrides,
  type SubmissionReviewData,
} from "../submissions";

const baseline: SubmissionReviewData = {
  name: "PERMEATE",
  description: "Enriched description",
  descriptionEn: null,
  blurb: null,
  blurbEn: null,
  city: "Taipei",
  categoryAttributes: null,
  reputationSummary: null,
  channels: [],
  mitEvidence: null,
  siteContent: null,
  foundingYear: 2020,
  heroImageUrl: "https://example.com/hero.webp",
  productType: "fashion",
  priceRange: 2,
  productTags: ["服飾"],
  productTagsEn: ["Apparel"],
  websiteUrl: "https://example.com",
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: "https://example.com",
  purchasePinkoi: null,
  purchaseShopee: null,
  otherUrls: [],
};

describe("refresh review overrides", () => {
  it("layers the complete brand snapshot before enrichment and admin overrides", () => {
    const enrichedBaseline = buildRefreshSubmissionReviewData(
      {
        name: "PERMEATE",
        description: "Snapshot description",
        description_en: "Snapshot English description",
        city: "Tainan",
        founding_year: 2018,
        price_range: 2,
        product_tags: ["服飾"],
      },
      {
        description: "Enriched description",
        city: "Taipei",
      },
      baseline,
    );

    expect(
      applySubmissionReviewOverrides(enrichedBaseline, {
        city: "Taichung",
      }),
    ).toMatchObject({
      description: "Enriched description",
      descriptionEn: "Snapshot English description",
      city: "Taichung",
      foundingYear: 2018,
      priceRange: 2,
    });
  });

  it("stores only values changed by the admin", () => {
    expect(
      buildSubmissionReviewOverrides(baseline, {
        ...baseline,
        description: "Admin description",
        city: null,
      }),
    ).toEqual({ description: "Admin description", city: null });
  });

  it("applies explicit nulls after enrichment values", () => {
    expect(
      applySubmissionReviewOverrides(baseline, {
        description: "Admin description",
        social_instagram: null,
      }),
    ).toMatchObject({
      description: "Admin description",
      socialInstagram: null,
      productType: "fashion",
    });
  });

  it("retains an admin-selected hero override across repeated saves", () => {
    const edited = {
      ...baseline,
      heroImageUrl: "https://example.com/admin-hero.webp",
    };
    const savedOverrides = buildSubmissionReviewOverrides(baseline, edited);
    const reloaded = applySubmissionReviewOverrides(baseline, savedOverrides);

    expect(buildSubmissionReviewOverrides(baseline, reloaded)).toMatchObject({
      hero_image_url: "https://example.com/admin-hero.webp",
    });
  });
});
