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
  reputationSummary: null,
  channels: [],
  siteContent: null,
  foundingYear: 2020,
  heroImageUrl: "https://example.com/hero.webp",
  categorySlug: "fashion",
  subcategories: ["服飾"],
  subcategoriesEn: ["Apparel"],
  websiteUrl: "https://example.com",
  socialInstagram: null,
  socialThreads: null,
  socialFacebook: null,
  purchaseWebsite: "https://example.com",
  purchasePinkoi: null,
  purchaseShopee: null,
  purchaseMyship: null,
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
        subcategories: ["服飾"],
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
      categorySlug: "fashion",
    });
  });

  // DEV-1278: hero identity is derived from active image ordering, so
  // hero_image_url is no longer an editable review override. The brands column
  // survives only as a list-view cache written by the RPCs.
  it("never persists hero_image_url as a review override", () => {
    const edited = {
      ...baseline,
      heroImageUrl: "https://example.com/admin-hero.webp",
    };

    expect(buildSubmissionReviewOverrides(baseline, edited)).toEqual({});
  });

  it("ignores a legacy stored hero_image_url override", () => {
    expect(
      applySubmissionReviewOverrides(baseline, {
        hero_image_url: "https://example.com/legacy-hero.webp",
        description: "Admin description",
      }),
    ).toMatchObject({
      description: "Admin description",
      heroImageUrl: "https://example.com/hero.webp",
    });
  });
});
