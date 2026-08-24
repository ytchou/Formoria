import { describe, it, expect } from "vitest";
import { toBrandRow, toSubmissionRow } from "@/lib/services/_shared/field-map";

const brandInput = {
  name: "森之好物",
  slug: "sen-zi-hao-wu",
  description: "Taiwan-made home goods and accessories",
  heroImageUrl: "/i/brands/brand-123/hero.webp",
  status: "approved",
  categorySlug: "home",
  foundingYear: 2018,
  socialInstagram: "@senzi",
  socialThreads: "https://threads.net/@senzi",
  socialFacebook: "https://facebook.com/senzi",
  purchaseWebsite: "https://senzi.tw",
  purchasePinkoi: "https://pinkoi.com/store/senzi",
  purchaseShopee: "https://shopee.tw/senzi",
  otherUrls: [{ label: "Line", url: "https://line.me/senzi" }],
  contactEmail: "hello@senzi.tw",
  subcategories: ["handmade", "home"],
  isDemo: true,
};

const submissionInput = {
  brandId: "brand-123",
  brandName: "森之好物",
  submitterEmail: "submitter@example.com",
  submitterName: "Jane Doe",
  description: "Taiwan-made home goods and accessories",
  websiteUrl: "https://senzi.tw/contact",
  heroImageUrl: "https://cdn.example.com/submit-hero.jpg",
  socialInstagram: "@senzi",
  socialThreads: "https://threads.net/@senzi",
  socialFacebook: "https://facebook.com/senzi",
  purchaseWebsite: "https://senzi.tw",
  purchasePinkoi: "https://pinkoi.com/store/senzi",
  purchaseShopee: "https://shopee.tw/senzi",
  otherUrls: [{ label: "Line", url: "https://line.me/senzi" }],
  suggestedSubcategories: ["organic", "minimal"],
  status: "approved",
  reviewerNotes: "Looks good",
  pdpaConsentAt: "2026-07-01T10:00:00Z",
  validationStatus: "valid",
  validationErrors: ["missing logo"],
  notifiedAt: "2026-07-01T11:00:00Z",
  isBrandOwner: true,
  sourceAttribution: "manual",
  categoryNote: "derived from retail concept",
};

describe("field-map", () => {
  // Most of this table is a mechanical camelCase -> snake_case rename, but two
  // entries are not, and they are why the assertion is exhaustive rather than
  // spot-checked: `categorySlug` becomes `category`, and `subcategories_en` is
  // DERIVED, not copied. An exhaustive toEqual also catches a leaked key —
  // `toBrandRow` omits undefined inputs, so an added column does not break it.
  it("renames every brand field to its column and derives subcategories_en", () => {
    expect(toBrandRow(brandInput)).toEqual({
      name: "森之好物",
      slug: "sen-zi-hao-wu",
      description: "Taiwan-made home goods and accessories",
      // DEV-1551 tasks 9 and 12: the brand hero is written as a bucket key.
      // `hero_image_url` is no longer written by TypeScript at all.
      hero_image_storage_path: "brands/brand-123/hero.webp",
      status: "approved",
      category: "home",
      founding_year: 2018,
      social_instagram: "@senzi",
      social_threads: "https://threads.net/@senzi",
      social_facebook: "https://facebook.com/senzi",
      purchase_website: "https://senzi.tw",
      purchase_pinkoi: "https://pinkoi.com/store/senzi",
      purchase_shopee: "https://shopee.tw/senzi",
      other_urls: [{ label: "Line", url: "https://line.me/senzi" }],
      contact_email: "hello@senzi.tw",
      subcategories: ["handmade", "home"],
      // Neither subcategory is in the ontology, so deriveSubcategoriesEn falls through to
      // the novel-subcategory path, which now Title Cases to match ontology nameEn casing.
      subcategories_en: ["Handmade", "Home"],
      is_demo: true,
    });
  });

  it("maps mitStory to mit_story when present", () => {
    const result = toBrandRow({
      mitStory: "Our fabrics come from Changhua weaving mills.",
    });
    expect(result.mit_story).toBe(
      "Our fabrics come from Changhua weaving mills.",
    );
  });

  it("omits mit_story when mitStory is undefined", () => {
    const result = toBrandRow({ name: "Test Brand" });
    expect("mit_story" in result).toBe(false);
  });

  it("sets mit_story to null when mitStory is null", () => {
    const result = toBrandRow({ mitStory: null });
    expect(result.mit_story).toBeNull();
  });

  it("submissions mapper shares the social/purchase block with brands", () => {
    const b = toBrandRow({
      ...brandInput,
      name: undefined,
      slug: undefined,
      description: undefined,
      heroImageUrl: undefined,
      status: undefined,
      categorySlug: undefined,
      foundingYear: undefined,
      otherUrls: undefined,
      contactEmail: undefined,
      subcategories: undefined,
      isDemo: undefined,
    });
    const s = toSubmissionRow(submissionInput);

    expect(s.social_instagram).toEqual(b.social_instagram);
    expect(s.social_threads).toEqual(b.social_threads);
    expect(s.social_facebook).toEqual(b.social_facebook);
    expect(s.purchase_website).toEqual(b.purchase_website);
    expect(s.purchase_pinkoi).toEqual(b.purchase_pinkoi);
    expect(s.purchase_shopee).toEqual(b.purchase_shopee);
    expect(s).toEqual({
      brand_id: "brand-123",
      brand_name: "森之好物",
      submitter_email: "submitter@example.com",
      submitter_name: "Jane Doe",
      description: "Taiwan-made home goods and accessories",
      website_url: "https://senzi.tw/contact",
      hero_image_url: "https://cdn.example.com/submit-hero.jpg",
      social_instagram: "@senzi",
      social_threads: "https://threads.net/@senzi",
      social_facebook: "https://facebook.com/senzi",
      purchase_website: "https://senzi.tw",
      purchase_pinkoi: "https://pinkoi.com/store/senzi",
      purchase_shopee: "https://shopee.tw/senzi",
      other_urls: [{ label: "Line", url: "https://line.me/senzi" }],
      suggested_tags: ["organic", "minimal"],
      status: "approved",
      reviewer_notes: "Looks good",
      pdpa_consent_at: "2026-07-01T10:00:00Z",
      validation_status: "valid",
      validation_errors: ["missing logo"],
      notified_at: "2026-07-01T11:00:00Z",
      is_brand_owner: true,
      source_attribution: "manual",
      category_note: "derived from retail concept",
    });
  });
});
