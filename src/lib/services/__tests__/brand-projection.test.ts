import { describe, it, expect } from "vitest";
import {
  BRAND_COLUMN_LIST,
  DIRECTORY_BRAND_COLUMN_LIST,
  DIRECTORY_OMITTED_COLUMNS,
  brandToDomain,
  type BrandRowWithJoins,
} from "../brands";
import { toPublicBrandCard, toPublicBrandDetail } from "@/lib/brands/contracts";

/**
 * Guards the narrow directory column projection.
 *
 * `brandToDomain` coerces every missing column with `?? null`, so dropping a
 * column from a SELECT produces a well-typed `Brand` with a silently null
 * field — TypeScript cannot catch it and no page throws. These tests hydrate a
 * domain object from the narrow projection and compare it field-by-field
 * against one hydrated from the full projection, so any column removed from
 * `DIRECTORY_BRAND_COLUMN_LIST` fails loudly here.
 */

/**
 * A distinct, non-null marker value per database column. Every value must
 * survive `brandToDomain` as something distinguishable from the `?? null`
 * fallback, otherwise dropping that column would go unnoticed.
 */
const COLUMN_FIXTURE: Record<string, unknown> = {
  id: "brand-1",
  name: "Test Brand",
  slug: "test-brand",
  description: "A test brand",
  description_en: "A test brand (en)",
  blurb: "Short blurb",
  blurb_en: "Short blurb (en)",
  hero_image_url: "https://example.com/hero.jpg",
  hero_image_storage_path: "brands/brand-1/hero.webp",
  category: "bags-accessories",
  contact_email: "private-contact-canary@example.com",
  city: "Taipei",
  purchase_website: "https://example.com",
  purchase_pinkoi: "https://pinkoi.com/store/example",
  purchase_shopee: "https://shopee.tw/example",
  purchase_myship: "https://myship.7-11.com.tw/general/detail/GM123456",
  social_instagram: "https://instagram.com/example",
  social_threads: "https://threads.net/@example",
  social_facebook: "https://facebook.com/example",
  other_urls: [{ url: "https://example.com/press", label: "Press" }],
  site_content: {
    template: "default",
    tokens: { accent: "#000000" },
    products: [],
  },
  status: "approved",
  submitted_at: "2026-01-01T00:00:00Z",
  approved_at: "2026-01-02T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-03T00:00:00Z",
  onboarding_dismissed_at: "2026-01-04T00:00:00Z",
  draft_data: { name: "PRIVATE_DRAFT_CANARY" },
  draft_updated_at: "2026-01-05T00:00:00Z",
  founding_year: 1998,
  subcategories: ["tote"],
  subcategories_en: ["tote-en"],
  reputation_summary: {
    text: "Well reviewed",
    sources: [{ url: "https://example.com/review" }],
  },
  mit_status: "verified",
  mit_declared_scope: "all",
  mit_declared_at: "2026-01-06T00:00:00Z",
  mit_verified_at: "2026-01-07T00:00:00Z",
  mit_story: "Made in Taiwan since 1998",
  mit_evidence: {
    mit_smile_cert: "CERT-123",
    source: "PRIVATE_EVIDENCE_CANARY",
  },
  source: "PRIVATE_PROVENANCE_CANARY",
  // `true` on purpose: brandToDomain falls back to `false`, so a `false`
  // fixture could not distinguish "column present" from "column dropped".
  is_demo: true,
};

function buildRow(columns: readonly string[]): BrandRowWithJoins {
  const row: Record<string, unknown> = {};
  for (const column of columns) {
    row[column] = COLUMN_FIXTURE[column];
  }
  return row as unknown as BrandRowWithJoins;
}

/**
 * Domain fields the narrow projection is *allowed* to lose, because no card,
 * directory page, or directory JSON-LD builder reads them. Adding an entry here
 * is a deliberate act: it means a consumer somewhere must be checked first.
 */
const FIELDS_OMITTED_ON_DIRECTORY_PATHS = [
  "siteContent",
  "reputationSummary",
  "mitEvidence",
];

/**
 * Fields read off the brand objects the directory renders — `BrandCard`
 * (src/components/brands/brand-card.tsx) and the ItemList JSON-LD builders in
 * src/lib/json-ld.ts, which are fed the same array as the cards.
 */
const DIRECTORY_CONSUMED_FIELDS = [
  "id",
  "name",
  "slug",
  "status",
  "categorySlug",
  "categoryLabel",
  "heroImageUrl",
  "description",
  "descriptionEn",
  "blurb",
  "blurbEn",
  "subcategories",
  "subcategoriesEn",
  "mitStatus",
];

describe("brand column projections", () => {
  it("has a fixture value for every column in the full projection", () => {
    const missing = BRAND_COLUMN_LIST.filter(
      (column) => !(column in COLUMN_FIXTURE),
    );
    expect(missing).toEqual([]);
  });

  it("omits exactly the four heavy/unpublished columns on directory paths", () => {
    expect([...DIRECTORY_OMITTED_COLUMNS]).toEqual([
      "site_content",
      "draft_data",
      "mit_evidence",
      "reputation_summary",
    ]);
  });

  it("never ships draft_data to directory consumers", () => {
    expect(DIRECTORY_BRAND_COLUMN_LIST).not.toContain("draft_data");
  });

  it("keeps purchase channels in the directory projection", () => {
    expect(DIRECTORY_BRAND_COLUMN_LIST).toContain("purchase_shopee");
    expect(DIRECTORY_BRAND_COLUMN_LIST).toContain("purchase_myship");
  });
});

describe("brandToDomain field completeness", () => {
  it("produces no undefined field from the full projection", () => {
    const brand = brandToDomain(
      buildRow(BRAND_COLUMN_LIST),
    ) as unknown as Record<string, unknown>;
    const undefinedFields = Object.keys(brand).filter(
      (key) => brand[key] === undefined,
    );
    expect(undefinedFields).toEqual([]);
  });

  it("yields the same values from the narrow projection, except the omitted jsonb fields", () => {
    const full = brandToDomain(
      buildRow(BRAND_COLUMN_LIST),
    ) as unknown as Record<string, unknown>;
    const narrow = brandToDomain(
      buildRow(DIRECTORY_BRAND_COLUMN_LIST),
    ) as unknown as Record<string, unknown>;

    const degraded = Object.keys(full).filter(
      (key) => JSON.stringify(narrow[key]) !== JSON.stringify(full[key]),
    );
    expect(degraded.sort()).toEqual(
      [...FIELDS_OMITTED_ON_DIRECTORY_PATHS].sort(),
    );
  });

  it("keeps every field the cards and directory JSON-LD read populated", () => {
    const narrow = brandToDomain(
      buildRow(DIRECTORY_BRAND_COLUMN_LIST),
    ) as unknown as Record<string, unknown>;

    for (const field of DIRECTORY_CONSUMED_FIELDS) {
      expect(
        narrow[field],
        `${field} missing from the narrow projection`,
      ).not.toBeUndefined();
      expect(
        narrow[field],
        `${field} nulled out by the narrow projection`,
      ).not.toBeNull();
    }
  });
});

describe("public brand response contracts", () => {
  it("keeps private canaries out of card and detail payloads", () => {
    const brand = brandToDomain(buildRow(BRAND_COLUMN_LIST));
    const payload = JSON.stringify([
      toPublicBrandCard(brand),
      toPublicBrandDetail(brand),
    ]);

    expect(payload).not.toContain("private-contact-canary@example.com");
    expect(payload).not.toContain("PRIVATE_DRAFT_CANARY");
    expect(payload).not.toContain("PRIVATE_EVIDENCE_CANARY");
    expect(payload).not.toContain("PRIVATE_PROVENANCE_CANARY");
    expect(payload).not.toContain("submittedAt");
    expect(payload).not.toContain("approvedAt");
    expect(payload).not.toContain("createdAt");
    expect(payload).not.toContain("updatedAt");
    expect(toPublicBrandDetail(brand).mitCertificateNumber).toBe("CERT-123");
  });
});

describe("brandToDomain image derivation (DEV-1551)", () => {
  it("emits a relative /i/ path for heroImageUrl", () => {
    const brand = brandToDomain({
      ...COLUMN_FIXTURE,
      hero_image_storage_path: "brands/brand-1/hero.webp",
    } as unknown as BrandRowWithJoins);

    expect(brand.heroImageUrl).toBe("/i/brands/brand-1/hero.webp");
  });

  it("falls back to the legacy column only as a bucket key, never as a link", () => {
    // The bucket key is preferred, but a null key is the common case for a
    // brand created by `approve_submission`, which writes only the legacy
    // column. The fallback re-derives the key and serves it through the proxy,
    // so the row renders; the raw supabase.co url is never emitted.
    const brand = brandToDomain({
      ...COLUMN_FIXTURE,
      hero_image_storage_path: null,
      hero_image_url:
        "https://project.supabase.co/storage/v1/object/public/brand-images/brands/brand-1/hero.webp",
    } as unknown as BrandRowWithJoins);

    expect(brand.heroImageUrl).toBe("/i/brands/brand-1/hero.webp");
  });

  it("treats an empty legacy column as absent", () => {
    // DEV-1551 gave `url` a '' default, so '' is the common case rather than
    // NULL and must not read as a usable value.
    const brand = brandToDomain({
      ...COLUMN_FIXTURE,
      hero_image_storage_path: null,
      hero_image_url: "",
    } as unknown as BrandRowWithJoins);

    expect(brand.heroImageUrl).toBeNull();
  });

  it("does not resolve a legacy url that is not one of our objects", () => {
    const brand = brandToDomain({
      ...COLUMN_FIXTURE,
      hero_image_storage_path: null,
      hero_image_url: "https://evil.example/brands/brand-1/hero.webp",
    } as unknown as BrandRowWithJoins);

    expect(brand.heroImageUrl).toBeNull();
  });
});
