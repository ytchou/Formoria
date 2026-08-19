import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COPY_ORDER,
  KNOWN_COLUMNS,
  computeSeoPromoted,
  parseOpenApiColumns,
  parseSelectArgs,
  parseSelectionFile,
  parseSyncArgs,
  planBrandIdRemap,
  planBrandRows,
  planBrandSelection,
  planChildRows,
  planColumnDrift,
  planCopyOrder,
  planImageUpserts,
  planMitRegistryCerts,
  planCategoryQuotas,
  planSlugRedirects,
  planWriteDiff,
  type Row,
  type SelectionCandidate,
} from "./sync-staging-from-prod";

const PROD_BRAND_ID = "9f2b1c40-0000-4000-8000-0000000000a1";
const PROD_BRAND_ID_B = "9f2b1c40-0000-4000-8000-0000000000a2";
const STAGING_BRAND_ID = "52000000-0000-4000-8000-0000000000b1";
const STAGING_BRAND_ID_B = "52000000-0000-4000-8000-0000000000b2";
const EVENT_ID = "6b1c9f2e-0000-4000-8000-000000000001";
const OWNER_USER_ID = "11111111-2222-4333-8444-555555555555";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function candidate(
  overrides: Partial<SelectionCandidate> & { slug: string },
): SelectionCandidate {
  return {
    id: `id-${overrides.slug}`,
    name: `品牌 ${overrides.slug}`,
    category: "home",
    city: "台北市",
    model_faq_count: 5,
    mit_status: "none",
    mit_evidence: null,
    description: "描".repeat(400),
    purchase_website: "https://example.tw",
    purchase_pinkoi: null,
    purchase_shopee: null,
    purchase_myship: null,
    imageCount: 6,
    channelCount: 2,
    isEventBrand: false,
    isRedirectTarget: false,
    ...overrides,
  };
}

/** Every production `brands` column, so the payload assertions are exhaustive. */
function prodBrandRow(overrides: Row = {}): Row {
  const row: Row = {
    id: PROD_BRAND_ID,
    slug: "kinyo-ceramics",
    name: "金淂陶藝",
    romanized_name: "Kinyo Ceramics",
    status: "approved",
    source: "curation",
    is_demo: false,
    description: "描".repeat(300),
    description_en: "Ceramics from Yingge.",
    blurb: "手作陶器",
    blurb_en: "Handmade ceramics",
    city: "新北市",
    founding_year: 1998,
    price_range: 2,
    category: "home",
    subcategories: ["陶器"],
    subcategories_en: ["ceramics"],
    hero_image_url: "https://images.example/hero.webp",
    other_urls: [],
    purchase_website: "https://kinyo.tw",
    purchase_pinkoi: null,
    purchase_shopee: null,
    purchase_myship: null,
    social_facebook: "https://facebook.com/kinyo",
    social_instagram: null,
    social_threads: null,
    reputation_summary: { text: "口碑良好", sources: [] },
    site_content: { about: "…" },
    mit_status: "verified",
    mit_story: "在鶯歌製作。",
    mit_evidence: { mit_smile_cert: "MIT-000123", mit_smile_listed: true },
    mit_declared_at: "2026-01-02T00:00:00Z",
    mit_declared_by: OWNER_USER_ID,
    mit_declared_scope: "all",
    mit_verified_at: "2026-01-03T00:00:00Z",
    model_faq_count: 7,
    seo_promoted: true,
    search_vector: "'陶':1",
    contact_email: "owner@kinyo.tw",
    draft_data: { name: "草稿" },
    draft_updated_at: "2026-02-01T00:00:00Z",
    onboarding_dismissed_at: "2026-02-02T00:00:00Z",
    brand_enriched_at: "2026-03-01T00:00:00Z",
    submitted_at: "2025-12-01T00:00:00Z",
    approved_at: "2025-12-05T00:00:00Z",
    created_at: "2025-11-01T00:00:00Z",
    updated_at: "2026-03-02T00:00:00Z",
  };
  return { ...row, ...overrides };
}

function imageRow(overrides: Row = {}): Row {
  return {
    id: "aaaa1111-0000-4000-8000-000000000001",
    brand_id: PROD_BRAND_ID,
    url: "https://images.example/one.webp",
    source: "site",
    source_url: "https://kinyo.tw/gallery/one.jpg",
    storage_path: "brand-images/kinyo/one.webp",
    status: "active",
    sort_order: 0,
    alt_zh: "陶碗",
    alt_en: "Ceramic bowl",
    tags: ["product"],
    width: 1200,
    height: 900,
    score: 0.82,
    sharpness: 0.7,
    entropy: 6.1,
    phash: "ff00ff00",
    dominant_color: "#c8b8a0",
    focal_x: 0.5,
    focal_y: 0.5,
    provider_metadata: { provider: "site-crawl" },
    rejected_at: null,
    rejection_reasons: null,
    created_at: "2026-01-10T00:00:00Z",
    ...overrides,
  };
}

function channelRow(overrides: Row = {}): Row {
  return {
    id: "bbbb2222-0000-4000-8000-000000000001",
    brand_id: PROD_BRAND_ID,
    name: "誠品信義店",
    normalized_name: "eslite-xinyi",
    channel_type: "offline",
    location_type: "department_store",
    region_label: "北部",
    country: "TW",
    district: "信義區",
    address: "台北市信義區松高路11號",
    url: "https://eslite.com",
    source: "places",
    source_url: "https://maps.google.com/…",
    provider_metadata: { place_id: "abc" },
    owner_status: "unconfirmed",
    owner_status_by: OWNER_USER_ID,
    last_confirmed_at: null,
    fetched_at: "2026-02-01T00:00:00Z",
    removed_at: null,
    removed_by: OWNER_USER_ID,
    created_by: OWNER_USER_ID,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function exhibitorRow(overrides: Row = {}): Row {
  return {
    id: "cccc3333-0000-4000-8000-000000000001",
    event_id: EVENT_ID,
    source_key: "creative-expo:322",
    source_url: "https://creativexpo.tw/zh-TW/exhibitor_list/322",
    name: "沃廚",
    name_en: "WOKY",
    booth: "K1-001",
    area: "文創品牌展區",
    area_en: "Cultural & Creative Brands",
    zone: "K1",
    event_category: "cultural_creative",
    summary_zh: "不鏽鋼保溫杯。",
    summary_en: "Insulated bottles.",
    image_url: null,
    image_storage_path: null,
    image_alt_zh: null,
    image_alt_en: null,
    content_source: "submission",
    content_submission_id: "dddd4444-0000-4000-8000-000000000001",
    content_verified_at: "2026-08-06T00:00:00Z",
    website_url: null,
    sort_order: 0,
    verified_at: "2026-08-06T00:00:00Z",
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-06T00:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const CATEGORIES = ["home", "food-drink", "beauty", "crafts"];

function selectionCandidates(): SelectionCandidate[] {
  const candidates: SelectionCandidate[] = [];
  for (const [categoryIndex, categorySlug] of CATEGORIES.entries()) {
    for (let index = 0; index < 15; index += 1) {
      candidates.push(
        candidate({
          slug: `${categorySlug}-${index}`,
          category: categorySlug,
          imageCount: index,
          channelCount: index % 3,
          // One zero-FAQ brand per category, deliberately not the first.
          model_faq_count: index === 7 ? 0 : 4 + index,
          city: index % 5 === 0 ? null : "台中市",
          isEventBrand: index % 4 === 0,
          isRedirectTarget: index % 6 === 0,
          description: index % 7 === 0 ? "短" : "描".repeat(400),
          mit_status: categoryIndex === 0 && index < 3 ? "verified" : "none",
        }),
      );
    }
  }
  return candidates;
}

describe("planBrandSelection", () => {
  const candidates = selectionCandidates();
  const pinnedSlugs = [
    "home-1",
    "beauty-2",
    "crafts-3",
    "gone-from-production",
  ];

  it("fills exactly the target when enough candidates exist", () => {
    const plan = planBrandSelection({
      candidates,
      pinnedSlugs,
      target: 40,
      seed: 1,
    });
    expect(plan.slugs).toHaveLength(40);
    expect(new Set(plan.slugs).size).toBe(40);
  });

  it("keeps every pinned slug that production still has", () => {
    const plan = planBrandSelection({
      candidates,
      pinnedSlugs,
      target: 30,
      seed: 1,
    });
    expect(plan.slugs).toEqual(
      expect.arrayContaining(["home-1", "beauty-2", "crafts-3"]),
    );
    expect(plan.rationale.pinned).toEqual(["beauty-2", "crafts-3", "home-1"]);
    // A staging brand with no production row cannot be copied onto, and is
    // reported rather than silently dropped.
    expect(plan.rationale.pinnedMissingFromProduction).toEqual([
      "gone-from-production",
    ]);
  });

  it("keeps pinned brands even when they outnumber the target", () => {
    const plan = planBrandSelection({
      candidates,
      pinnedSlugs: candidates.slice(0, 20).map((brand) => brand.slug),
      target: 5,
      seed: 1,
    });
    for (const brand of candidates.slice(0, 20)) {
      expect(plan.slugs).toContain(brand.slug);
    }
  });

  it("includes at least one zero-FAQ brand per category", () => {
    const plan = planBrandSelection({
      candidates,
      pinnedSlugs,
      target: 30,
      seed: 1,
    });
    const selected = new Set(plan.slugs);
    for (const categorySlug of CATEGORIES) {
      const zeroFaq = candidates.filter(
        (brand) =>
          brand.category === categorySlug && brand.model_faq_count === 0,
      );
      expect(zeroFaq.some((brand) => selected.has(brand.slug))).toBe(true);
    }
  });

  it("includes every mit_status=verified brand", () => {
    const plan = planBrandSelection({
      candidates,
      pinnedSlugs,
      target: 30,
      seed: 1,
    });
    const verified = candidates.filter(
      (brand) => brand.mit_status === "verified",
    );
    expect(verified).toHaveLength(3);
    for (const brand of verified) expect(plan.slugs).toContain(brand.slug);
    expect(plan.rationale.coverage.mitVerified).toBe(3);
  });

  it("meets the event, redirect, seo and city coverage floors", () => {
    const { coverage } = planBrandSelection({
      candidates,
      pinnedSlugs,
      target: 30,
      seed: 1,
    }).rationale;
    expect(coverage.eventBrands).toBeGreaterThanOrEqual(10);
    expect(coverage.redirectTargets).toBeGreaterThanOrEqual(5);
    expect(coverage.seoPromotedFalse).toBeGreaterThanOrEqual(5);
    expect(coverage.cityNull).toBeGreaterThanOrEqual(3);
    expect(coverage.cityPresent).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic for a given seed", () => {
    const first = planBrandSelection({
      candidates,
      pinnedSlugs,
      target: 30,
      seed: 7,
    });
    const second = planBrandSelection({
      candidates: [...candidates].reverse(),
      pinnedSlugs: [...pinnedSlugs].reverse(),
      target: 30,
      seed: 7,
    });
    expect(second.slugs).toEqual(first.slugs);
    expect(second.rationale).toEqual(first.rationale);
  });

  it("counts every selected brand in byCategory", () => {
    const plan = planBrandSelection({
      candidates,
      pinnedSlugs,
      target: 30,
      seed: 1,
    });
    const total = Object.values(plan.rationale.byCategory).reduce(
      (sum, count) => sum + count,
      0,
    );
    expect(total).toBe(plan.slugs.length);
  });

  it("rejects a target below one", () => {
    expect(() =>
      planBrandSelection({ candidates, pinnedSlugs: [], target: 0, seed: 1 }),
    ).toThrow("Selection target must be at least 1");
  });
});

describe("planCategoryQuotas", () => {
  it("apportions exactly the target across categories", () => {
    const quotas = planCategoryQuotas(selectionCandidates(), 100);
    const total = [...quotas.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(100);
    expect(quotas.get("home")).toBe(25);
  });

  it("groups brands with no category under a single key", () => {
    const quotas = planCategoryQuotas(
      [
        candidate({ slug: "a", category: null }),
        candidate({ slug: "b", category: "  " }),
        candidate({ slug: "c", category: "home" }),
      ],
      3,
    );
    expect(quotas.get("unknown")).toBe(2);
    expect(quotas.get("home")).toBe(1);
  });
});

describe("computeSeoPromoted", () => {
  const base = {
    description: "描".repeat(200),
    city: "台北市",
    model_faq_count: 0,
    purchase_website: "https://example.tw",
    purchase_pinkoi: null,
    purchase_shopee: null,
    purchase_myship: null,
  };

  it("mirrors the generated column", () => {
    expect(computeSeoPromoted(base)).toBe(true);
    expect(computeSeoPromoted({ ...base, description: "短" })).toBe(false);
    expect(computeSeoPromoted({ ...base, purchase_website: "  " })).toBe(false);
    expect(computeSeoPromoted({ ...base, city: null })).toBe(false);
    // No city is survivable with enough model FAQ entries.
    expect(
      computeSeoPromoted({ ...base, city: null, model_faq_count: 3 }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Selection file
// ---------------------------------------------------------------------------

describe("parseSelectionFile", () => {
  it("accepts a well-formed selection", () => {
    expect(parseSelectionFile({ slugs: ["kinyo-ceramics", "woky"] })).toEqual([
      "kinyo-ceramics",
      "woky",
    ]);
  });

  it("rejects a missing slugs array", () => {
    expect(() => parseSelectionFile({ target: 100 })).toThrow(
      "Selection file must contain a slugs array",
    );
    expect(() => parseSelectionFile(["kinyo-ceramics"])).toThrow(
      "Selection file must contain a JSON object",
    );
  });

  it("rejects an empty selection", () => {
    expect(() => parseSelectionFile({ slugs: [] })).toThrow(
      "Selection file lists no slugs",
    );
  });

  it("rejects duplicates", () => {
    expect(() => parseSelectionFile({ slugs: ["woky", "woky"] })).toThrow(
      'Selection file lists "woky" more than once',
    );
  });

  it("rejects slugs that are not URL-safe", () => {
    for (const bad of [
      "kinyo ceramics",
      "kinyo/ceramics",
      "kinyo?a=1",
      "kinyo#top",
      "-kinyo",
      "kinyo-",
      "",
      "x".repeat(81),
    ]) {
      expect(() => parseSelectionFile({ slugs: [bad] })).toThrow(
        /is not URL-safe/,
      );
    }
  });

  /**
   * 45 of production's 795 approved brands carry Han characters in their slug,
   * from an import path that predates `slugifyRomanizedName`. They are live and
   * approved, so the selection file has to round-trip them. An ASCII-kebab rule
   * borrowed from the write path rejected `廣源良-mit` and aborted the whole sync.
   */
  it("accepts the Han-character slugs production actually serves", () => {
    const real = [
      "廣源良-mit",
      "新北坪林阿純茶園",
      "裏-外",
      "chez-城市系列",
      "大山北月-森林步道-x-策展空間-x-慢活餐飲",
    ];
    expect(parseSelectionFile({ slugs: real })).toEqual(real);
  });
});

// ---------------------------------------------------------------------------
// Row planners
// ---------------------------------------------------------------------------

describe("planBrandRows", () => {
  const [payload] = planBrandRows([prodBrandRow()]);

  it("omits the columns that must never reach the insert", () => {
    // id: ON CONFLICT (slug) would rewrite staging's primary keys.
    // seo_promoted: GENERATED ALWAYS. search_vector: trigger-maintained.
    // model_faq_count: owned by sync_brand_model_faq_count.
    for (const column of [
      "id",
      "seo_promoted",
      "search_vector",
      "model_faq_count",
    ]) {
      expect(payload).not.toHaveProperty(column);
    }
  });

  it("nulls owner PII and every auth.users reference", () => {
    expect(payload.contact_email).toBeNull();
    expect(payload.mit_declared_by).toBeNull();
    expect(payload.draft_data).toBeNull();
    expect(payload.draft_updated_at).toBeNull();
    expect(payload.onboarding_dismissed_at).toBeNull();
  });

  it("copies every other column verbatim", () => {
    const source = prodBrandRow();
    const omitted = new Set([
      "id",
      "seo_promoted",
      "search_vector",
      "model_faq_count",
      "contact_email",
      "mit_declared_by",
      "draft_data",
      "draft_updated_at",
      "onboarding_dismissed_at",
    ]);
    const expected = Object.keys(source).filter(
      (column) => !omitted.has(column),
    );
    expect(Object.keys(payload).sort()).toEqual(
      [
        ...expected,
        "contact_email",
        "mit_declared_by",
        "draft_data",
        "draft_updated_at",
        "onboarding_dismissed_at",
      ].sort(),
    );
    for (const column of expected) {
      expect(payload[column]).toEqual(source[column]);
    }
  });

  it("refuses a production column it has never been told about", () => {
    expect(() =>
      planBrandRows([prodBrandRow({ owner_referral_code: "abc" })]),
    ).toThrow(/brands\.owner_referral_code exists in production/);
  });
});

describe("planBrandIdRemap", () => {
  it("maps production ids onto staging ids by slug", () => {
    const { map, missing } = planBrandIdRemap(
      [
        { id: PROD_BRAND_ID, slug: "kinyo-ceramics" },
        { id: PROD_BRAND_ID_B, slug: "woky" },
      ],
      [
        { id: STAGING_BRAND_ID, slug: "kinyo-ceramics" },
        { id: STAGING_BRAND_ID_B, slug: "woky" },
      ],
    );
    expect(missing).toEqual([]);
    expect(map.get(PROD_BRAND_ID)).toBe(STAGING_BRAND_ID);
    expect(map.get(PROD_BRAND_ID_B)).toBe(STAGING_BRAND_ID_B);
  });

  it("reports missing slugs rather than returning a partial map silently", () => {
    const { map, missing } = planBrandIdRemap(
      [
        { id: PROD_BRAND_ID, slug: "kinyo-ceramics" },
        { id: PROD_BRAND_ID_B, slug: "woky" },
      ],
      [{ id: STAGING_BRAND_ID, slug: "kinyo-ceramics" }],
    );
    expect(missing).toEqual(["woky"]);
    expect(map.size).toBe(1);
  });

  it("rejects a staging id that resolves back to another slug", () => {
    expect(() =>
      planBrandIdRemap(
        [{ id: PROD_BRAND_ID, slug: "kinyo-ceramics" }],
        [
          { id: STAGING_BRAND_ID, slug: "kinyo-ceramics" },
          { id: STAGING_BRAND_ID, slug: "woky" },
        ],
      ),
    ).toThrow(/resolves to staging row .* whose slug is "woky"/);
  });

  it("rejects two staging rows sharing a slug", () => {
    expect(() =>
      planBrandIdRemap(
        [{ id: PROD_BRAND_ID, slug: "woky" }],
        [
          { id: STAGING_BRAND_ID, slug: "woky" },
          { id: STAGING_BRAND_ID_B, slug: "woky" },
        ],
      ),
    ).toThrow('Staging returned two brands with slug "woky"');
  });
});

describe("planChildRows", () => {
  const idMap = new Map([[PROD_BRAND_ID, STAGING_BRAND_ID]]);

  it("remaps brand_id and strips the production channel id", () => {
    const { rows, unmapped } = planChildRows(
      "brand_channels",
      [channelRow()],
      idMap,
    );
    expect(unmapped).toEqual([]);
    expect(rows[0].brand_id).toBe(STAGING_BRAND_ID);
    expect(rows[0]).not.toHaveProperty("id");
    expect(rows[0].normalized_name).toBe("eslite-xinyi");
  });

  it("nulls every production user reference on a channel", () => {
    const [row] = planChildRows("brand_channels", [channelRow()], idMap).rows;
    // removed_by has no foreign key, so nothing else would stop a production
    // user id from landing in staging.
    expect(row.created_by).toBeNull();
    expect(row.owner_status_by).toBeNull();
    expect(row.removed_by).toBeNull();
  });

  it("nulls an exhibitor's content_submission_id", () => {
    const { rows } = planChildRows(
      "event_exhibitors",
      [exhibitorRow()],
      new Map(),
    );
    expect(rows[0].content_submission_id).toBeNull();
    expect(rows[0].id).toBe("cccc3333-0000-4000-8000-000000000001");
    expect(rows[0].event_id).toBe(EVENT_ID);
  });

  it("reports an unmappable brand_id instead of writing the row", () => {
    const { rows, unmapped } = planChildRows(
      "brand_channels",
      [channelRow(), channelRow({ brand_id: PROD_BRAND_ID_B })],
      idMap,
    );
    expect(rows).toHaveLength(1);
    expect(unmapped).toEqual([PROD_BRAND_ID_B]);
  });

  it("keeps event_brands linked to its exhibitor row", () => {
    const { rows } = planChildRows(
      "event_brands",
      [
        {
          id: "eeee5555-0000-4000-8000-000000000001",
          event_id: EVENT_ID,
          brand_id: PROD_BRAND_ID,
          event_exhibitor_id: "cccc3333-0000-4000-8000-000000000001",
          booth: "K1-001",
          area: null,
          area_en: null,
          note: null,
          note_en: null,
          sort_order: 0,
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
      idMap,
    );
    expect(rows[0]).not.toHaveProperty("id");
    expect(rows[0].event_exhibitor_id).toBe(
      "cccc3333-0000-4000-8000-000000000001",
    );
    expect(rows[0].brand_id).toBe(STAGING_BRAND_ID);
  });
});

describe("planImageUpserts", () => {
  const idMap = new Map([[PROD_BRAND_ID, STAGING_BRAND_ID]]);

  it("partitions on source_url", () => {
    const plan = planImageUpserts(
      [
        imageRow(),
        imageRow({
          id: "aaaa1111-0000-4000-8000-000000000002",
          source_url: null,
        }),
      ],
      idMap,
    );
    expect(plan.withSourceUrl).toHaveLength(1);
    expect(plan.withoutSourceUrl).toHaveLength(1);
    expect(plan.unmapped).toEqual([]);
  });

  it("drops the production id only where a natural key exists", () => {
    const plan = planImageUpserts(
      [
        imageRow(),
        imageRow({
          id: "aaaa1111-0000-4000-8000-000000000002",
          source_url: null,
        }),
      ],
      idMap,
    );
    expect(plan.withSourceUrl[0]).not.toHaveProperty("id");
    // NULL never conflicts with NULL in a unique index, so these rows have to
    // conflict on the primary key or every run duplicates them.
    expect(plan.withoutSourceUrl[0].id).toBe(
      "aaaa1111-0000-4000-8000-000000000002",
    );
  });

  it("remaps brand_id and keeps provider_metadata", () => {
    const plan = planImageUpserts([imageRow()], idMap);
    expect(plan.withSourceUrl[0].brand_id).toBe(STAGING_BRAND_ID);
    expect(plan.withSourceUrl[0].provider_metadata).toEqual({
      provider: "site-crawl",
    });
  });

  it("reports an unmappable brand_id", () => {
    const plan = planImageUpserts(
      [imageRow({ brand_id: PROD_BRAND_ID_B })],
      idMap,
    );
    expect(plan.withSourceUrl).toEqual([]);
    expect(plan.unmapped).toEqual([PROD_BRAND_ID_B]);
  });
});

describe("planSlugRedirects", () => {
  const redirects: Row[] = [
    {
      old_slug: "kinyo",
      new_slug: "kinyo-ceramics",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      old_slug: "woky-old",
      new_slug: "woky",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];

  it("keeps only redirects pointing at a selected brand", () => {
    const plan = planSlugRedirects(redirects, ["kinyo-ceramics"], []);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].old_slug).toBe("kinyo");
  });

  it("skips an old_slug that is a live staging brand", () => {
    const plan = planSlugRedirects(redirects, ["kinyo-ceramics"], ["kinyo"]);
    expect(plan.rows).toEqual([]);
    expect(plan.skippedOldSlugs).toEqual(["kinyo"]);
  });
});

describe("planMitRegistryCerts", () => {
  it("extracts the cert number a verified brand already stores", () => {
    expect(planMitRegistryCerts([prodBrandRow()])).toEqual(["MIT-000123"]);
  });

  it("deduplicates and ignores brands with no usable evidence", () => {
    expect(
      planMitRegistryCerts([
        prodBrandRow(),
        prodBrandRow({ slug: "b" }),
        prodBrandRow({ slug: "c", mit_evidence: null }),
        prodBrandRow({ slug: "d", mit_evidence: "not-an-object" }),
        prodBrandRow({ slug: "e", mit_evidence: ["array"] }),
        prodBrandRow({ slug: "f", mit_evidence: { mit_smile_cert: "   " } }),
        prodBrandRow({ slug: "g", mit_evidence: { mit_smile_cert: 42 } }),
      ]),
    ).toEqual(["MIT-000123"]);
  });
});

// ---------------------------------------------------------------------------
// Ordering and preflight
// ---------------------------------------------------------------------------

describe("planCopyOrder", () => {
  const order = planCopyOrder();
  const at = (table: string) => order.indexOf(table as (typeof order)[number]);

  it("writes brands before every brand-keyed child", () => {
    for (const child of [
      "brand_images",
      "brand_faq_entries",
      "brand_channels",
      "event_brands",
    ]) {
      expect(at("brands")).toBeLessThan(at(child));
    }
  });

  it("writes events and exhibitors before event_brands", () => {
    expect(at("events")).toBeLessThan(at("event_brands"));
    expect(at("event_exhibitors")).toBeLessThan(at("event_brands"));
  });

  it("covers exactly the copied tables", () => {
    expect(order).toEqual([...COPY_ORDER]);
    expect(Object.keys(KNOWN_COLUMNS).sort()).toEqual([...order].sort());
  });
});

/**
 * `KNOWN_COLUMNS` is transcribed by hand and the sync client is untyped, so
 * nothing in the type system holds it to the table. The existing planCopyOrder
 * test compares only the KEYS of KNOWN_COLUMNS against COPY_ORDER — it never
 * looks at a column list. Both drift directions are live: a stale entry makes
 * the production read 42703 against staging, a missing one makes
 * assertKnownColumns throw once production catches up.
 *
 * The generated types file is read as TEXT, in the style of
 * remove-brand-columns.test.ts: `Row` is a type with no runtime keys to
 * enumerate, and the file is regenerated from the live schema.
 */
describe("KNOWN_COLUMNS", () => {
  const databaseTypes = readFileSync(
    new URL("../src/lib/supabase/database.types.ts", import.meta.url),
    "utf8",
  );

  function rowColumns(tableName: string): string[] {
    // The first `Row: {` block after the table key, up to its closing brace.
    const table = databaseTypes.slice(
      databaseTypes.indexOf(`      ${tableName}: {`),
    );
    const rowStart = table.indexOf("Row: {");
    const rowEnd = table.indexOf("\n        }", rowStart);
    if (rowStart === -1 || rowEnd === -1)
      throw new Error(
        `${tableName} Row block not found in database.types.ts — regenerate the types`,
      );
    return [
      ...table.slice(rowStart, rowEnd).matchAll(/^\s{10}(\w+)\??:/gm),
    ].map(([, name]) => name!);
  }

  it("lists exactly the columns of every copied table row", () => {
    for (const table of COPY_ORDER) {
      const actual = rowColumns(table);

      expect(actual.length, table).toBeGreaterThan(0);
      // Sorted: the list is ordered for readability, the generated type is
      // alphabetical, and ORDER is not part of the invariant.
      expect([...KNOWN_COLUMNS[table]].sort(), table).toEqual(
        [...actual].sort(),
      );
    }
  });

  it("lists every column once", () => {
    for (const table of COPY_ORDER) {
      expect(new Set(KNOWN_COLUMNS[table]).size, table).toBe(
        KNOWN_COLUMNS[table].length,
      );
    }
  });
});

describe("parseOpenApiColumns", () => {
  it("reads a Swagger 2 document", () => {
    const columns = parseOpenApiColumns({
      definitions: {
        brands: { properties: { id: {}, slug: {} } },
        events: { properties: { id: {} } },
      },
    });
    expect([...(columns.get("brands") ?? [])]).toEqual(["id", "slug"]);
  });

  it("reads an OpenAPI 3 document", () => {
    const columns = parseOpenApiColumns({
      components: { schemas: { brands: { properties: { slug: {} } } } },
    });
    expect(columns.get("brands")?.has("slug")).toBe(true);
  });

  it("returns nothing for a document it cannot read", () => {
    expect(parseOpenApiColumns("nope").size).toBe(0);
    expect(parseOpenApiColumns({ definitions: 3 }).size).toBe(0);
  });
});

describe("planColumnDrift", () => {
  const prod = new Map([["brands", new Set(["id", "slug", "blurb"])]]);

  it("is silent when staging is a superset", () => {
    const staging = new Map([
      ["brands", new Set(["id", "slug", "blurb", "x"])],
    ]);
    expect(planColumnDrift(prod, staging, ["brands"])).toEqual([]);
  });

  it("names the columns staging is missing", () => {
    const staging = new Map([["brands", new Set(["id"])]]);
    expect(planColumnDrift(prod, staging, ["brands"])).toEqual([
      { table: "brands", columns: ["blurb", "slug"] },
    ]);
  });

  it("reports a table absent on either side", () => {
    expect(planColumnDrift(prod, new Map(), ["brands"])[0].columns).toEqual([
      "<table missing from staging>",
    ]);
    expect(
      planColumnDrift(new Map(), new Map(), ["brands"])[0].columns,
    ).toEqual(["<table missing from production>"]);
  });
});

describe("planWriteDiff", () => {
  it("separates inserts, updates and no-ops on the conflict key", () => {
    const planned: Row[] = [
      { slug: "a", name: "A" },
      { slug: "b", name: "B2" },
      { slug: "c", name: "C" },
    ];
    const existing: Row[] = [
      { slug: "b", name: "B1" },
      { slug: "c", name: "C" },
    ];
    expect(planWriteDiff(planned, existing, ["slug"])).toEqual({
      wouldInsert: 1,
      wouldUpdate: 1,
      unchanged: 1,
    });
  });

  it("supports a composite conflict key", () => {
    const planned: Row[] = [{ brand_id: "x", source_url: "u", url: "1" }];
    const existing: Row[] = [{ brand_id: "x", source_url: "v", url: "1" }];
    expect(
      planWriteDiff(planned, existing, ["brand_id", "source_url"]).wouldInsert,
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

describe("argument parsing", () => {
  it("defaults the selection to 100 brands at seed 1", () => {
    expect(parseSelectArgs([])).toEqual({
      target: 100,
      seed: 1,
      dryRun: false,
    });
    expect(
      parseSelectArgs(["--target", "40", "--seed=9", "--dry-run"]),
    ).toEqual({ target: 40, seed: 9, dryRun: true });
  });

  it("rejects a non-integer target", () => {
    expect(() => parseSelectArgs(["--target", "0"])).toThrow(
      "--target must be a positive integer",
    );
    expect(() => parseSelectArgs(["--target", "ten"])).toThrow(
      "--target must be a positive integer",
    );
  });

  it("parses --only and --slug", () => {
    expect(parseSyncArgs(["--only", "brands,brand_images"])).toEqual({
      dryRun: false,
      only: ["brands", "brand_images"],
      slugs: null,
    });
    expect(
      parseSyncArgs(["--slug", "woky", "--slug", "kinyo-ceramics"]).slugs,
    ).toEqual(["woky", "kinyo-ceramics"]);
  });

  it("rejects an unknown table in --only", () => {
    expect(() => parseSyncArgs(["--only", "brand_owners"])).toThrow(
      /--only names unknown table "brand_owners"/,
    );
  });
});

// ---------------------------------------------------------------------------
// Source-level guarantees
// ---------------------------------------------------------------------------

describe("script source", () => {
  const source = readFileSync(
    new URL("./sync-staging-from-prod.ts", import.meta.url),
    "utf8",
  );

  it("contains no delete call at all", () => {
    // The sync is additive. A delete here would run against staging with a
    // service-role key and no dry-run branch can be trusted to gate it.
    expect(source).not.toMatch(/\.delete\(/);
  });

  it("reads no credential-shaped environment variable", () => {
    // .env.local holds PRODUCTION under the generic Supabase names, so an
    // environment-sourced credential would silently target the wrong project.
    const credentialEnv = new RegExp(
      "process\\.env\\.[A-Z][A-Z0-9_]*(?:_KEY|_URL|_SECRET|_TOKEN|_DSN)",
    );
    expect(source).not.toMatch(credentialEnv);
  });

  it("wraps the production client in the write blocker", () => {
    expect(source).toMatch(/createWriteBlockingClient\(url, key\)/);
  });
});
