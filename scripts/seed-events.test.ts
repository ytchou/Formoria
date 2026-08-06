import { describe, expect, it } from "vitest";
import {
  exhibitorCoverage,
  parseExhibitorLedger,
  parseEventFile,
  planEventExhibitorSeed,
  planEventSeed,
  type EventBrandInput,
  type EventFileInput,
} from "./seed-events";

const SUPABASE_URL = "https://xkcayngbttpxyibgzern.supabase.co";
const HERO_URL = `${SUPABASE_URL}/storage/v1/object/public/brand-images/events/hero.webp`;

const EVENT_ID = "6b1c9f2e-0000-4000-8000-000000000001";
const BRAND_ID_A = "6b1c9f2e-0000-4000-8000-00000000000a";
const BRAND_ID_B = "6b1c9f2e-0000-4000-8000-00000000000b";

function makeFile(overrides: Partial<EventFileInput> = {}): EventFileInput {
  return {
    slug: "taipei-design-market-2026",
    name: "台北設計市集 2026",
    summary: "集結百家台灣品牌的年度設計市集。",
    startsOn: "2026-08-06",
    endsOn: "2026-08-09",
    ...overrides,
  };
}

function plan(
  brands: EventBrandInput[] | null | undefined,
  existingBrandIds: string[],
) {
  return planEventSeed({
    eventSlug: "taipei-design-market-2026",
    eventId: EVENT_ID,
    brands: brands === undefined ? null : brands,
    brandIdsBySlug: new Map([
      ["kinyo-ceramics", BRAND_ID_A],
      ["liuli-atelier", BRAND_ID_B],
    ]),
    existingBrandIds,
  });
}

function ledgerRaw(overrides: Record<string, unknown> = {}) {
  const base = {
    schemaVersion: 1,
    eventSlug: "taipei-design-market-2026",
    reportTimeEvidence: {
      retrievedAt: "2026-08-06",
      sourceUrl: "https://creativexpo.tw/zh-TW/exhibitor_list",
      checkpoint: { K1: 1, K2: 1, K3: 1, S: 1 },
    },
    outcomes: [
      "matched_existing",
      "included_unlinked",
      "excluded",
      "needs_review",
      "out_of_scope",
    ],
    exhibitors: [
      {
        sourceKey: "creative-expo:322",
        name: "沃廚",
        nameEn: "WOKY",
        booth: "K1-001",
        area: "文創品牌展區",
        areaEn: "Cultural & Creative Brands",
        zone: "K1",
        eventCategory: "cultural_creative",
        sourceUrl: "https://creativexpo.tw/zh-TW/exhibitor_list/322",
        websiteUrl: null,
        verifiedAt: "2026-08-06",
        sortOrder: 0,
        reviewPriority: "high",
        verificationEvidence: {
          sourceUrl: "https://creativexpo.tw/zh-TW/exhibitor_list",
          detailUrl: "https://creativexpo.tw/zh-TW/exhibitor_list/322",
          retrievedAt: "2026-08-06",
          basis: "official listing",
        },
        outcome: "matched_existing",
        brandSlug: "woky",
      },
      {
        sourceKey: "creative-expo:323",
        name: "未連結品牌",
        nameEn: null,
        booth: "K2-001",
        area: "文創品牌展區",
        areaEn: "Cultural & Creative Brands",
        zone: "K2",
        eventCategory: "cultural_creative",
        sourceUrl: "https://creativexpo.tw/zh-TW/exhibitor_list/323",
        websiteUrl: null,
        verifiedAt: "2026-08-06",
        sortOrder: 1,
        reviewPriority: "medium",
        verificationEvidence: {
          sourceUrl: "https://creativexpo.tw/zh-TW/exhibitor_list",
          detailUrl: "https://creativexpo.tw/zh-TW/exhibitor_list/323",
          retrievedAt: "2026-08-06",
          basis: "official listing",
        },
        outcome: "included_unlinked",
      },
      {
        sourceKey: "creative-expo:324",
        name: "待審品牌",
        nameEn: null,
        booth: "K3-001",
        area: "文創品牌展區",
        areaEn: "Cultural & Creative Brands",
        zone: "K3",
        eventCategory: "cultural_creative",
        sourceUrl: "https://creativexpo.tw/zh-TW/exhibitor_list/324",
        websiteUrl: null,
        verifiedAt: "2026-08-06",
        sortOrder: 2,
        reviewPriority: "medium",
        verificationEvidence: {
          sourceUrl: "https://creativexpo.tw/zh-TW/exhibitor_list",
          detailUrl: "https://creativexpo.tw/zh-TW/exhibitor_list/324",
          retrievedAt: "2026-08-06",
          basis: "official listing",
        },
        outcome: "included_unlinked",
      },
      {
        sourceKey: "creative-expo:325",
        name: "延後審查",
        nameEn: null,
        booth: "S-001",
        area: "新銳品牌展區",
        areaEn: "Start-ups",
        zone: "S",
        eventCategory: "startups",
        sourceUrl: "https://creativexpo.tw/zh-TW/exhibitor_list/325",
        websiteUrl: null,
        verifiedAt: "2026-08-06",
        sortOrder: 3,
        reviewPriority: "low",
        verificationEvidence: {
          sourceUrl: "https://creativexpo.tw/zh-TW/exhibitor_list",
          detailUrl: "https://creativexpo.tw/zh-TW/exhibitor_list/325",
          retrievedAt: "2026-08-06",
          basis: "official listing",
        },
        outcome: "out_of_scope",
      },
    ],
    ...overrides,
  };
  return base;
}

describe("parseEventFile", () => {
  it("parseEventFile_rejects_bad_slug: names the offending slug", () => {
    expect(() =>
      parseEventFile("bad-slug.json", makeFile({ slug: "Taipei_Market" })),
    ).toThrow(/Taipei_Market/);
  });

  it("parseEventFile_rejects_inverted_dates: endsOn before startsOn", () => {
    expect(() =>
      parseEventFile(
        "inverted.json",
        makeFile({ startsOn: "2026-08-09", endsOn: "2026-08-06" }),
      ),
    ).toThrow(/2026-08-06/);
  });

  it("parseEventFile_rejects_foreign_image_host: hero outside Supabase Storage", () => {
    expect(() =>
      parseEventFile(
        "foreign-host.json",
        makeFile({ heroImageUrl: "https://cdn.example.com/hero.jpg" }),
      ),
    ).toThrow(/cdn\.example\.com/);

    // The same field on the storage origin is accepted, so the guard is about
    // the host and not about heroImageUrl being set at all.
    const parsed = parseEventFile(
      "ok.json",
      makeFile({ heroImageUrl: HERO_URL }),
    );
    expect(parsed.row.hero_image_url).toBe(HERO_URL);
  });

  it("parseEventFile_accepts_short_brand_slug: brand slugs follow the brands rule, not the events one", () => {
    // `brands.slug` has no CHECK constraint; the canonical rule is `isValidSlug`
    // in src/lib/services/brands.ts, which allows a 1-character slug. Validating
    // brand slugs with the events pattern (min 3 chars) made a legitimate
    // 2-character brand abort the entire run before a client was even created.
    const parsed = parseEventFile(
      "short-brand.json",
      makeFile({ brands: [{ slug: "ao" }] }),
    );

    expect(parsed.brands?.map((brand) => brand.slug)).toEqual(["ao"]);
  });

  it("parseEventFile_rejects_bad_brand_slug: uppercase and underscores still fail", () => {
    expect(() =>
      parseEventFile(
        "bad-brand.json",
        makeFile({ brands: [{ slug: "Kinyo_Ceramics" }] }),
      ),
    ).toThrow(/Kinyo_Ceramics/);
  });

  it("maps camelCase input onto the snake_case row and defaults status to draft", () => {
    const parsed = parseEventFile(
      "ok.json",
      makeFile({ nameEn: "Taipei Design Market 2026" }),
    );

    expect(parsed.row.slug).toBe("taipei-design-market-2026");
    expect(parsed.row.name_en).toBe("Taipei Design Market 2026");
    expect(parsed.row.starts_on).toBe("2026-08-06");
    expect(parsed.row.status).toBe("draft");
    expect(parsed.brands).toBeNull();
  });

  it("parseEventFile_preserves_schedule_note_newlines: multi-line visitor info survives the mapper", () => {
    // `scheduleNote` is the one visitor-info field authored as multiple lines
    // (one per day band), and the detail page renders it with
    // `whitespace-pre-line`. `optionalString` trims the ends only, so the
    // interior newlines must come through untouched — collapsing them would
    // merge the trade-buyer-only band into the general-admission one.
    const scheduleNote = "8/6-8/7 專業買家日\n8/8-8/9 一般民眾日";
    const parsed = parseEventFile(
      "schedule.json",
      makeFile({
        scheduleNote: `\n${scheduleNote}\n`,
        scheduleNoteEn: "Trade buyers 6-7 Aug\nGeneral admission 8-9 Aug",
      }),
    );

    expect(parsed.row.schedule_note).toBe(scheduleNote);
    expect(parsed.row.schedule_note_en).toBe(
      "Trade buyers 6-7 Aug\nGeneral admission 8-9 Aug",
    );
    // Unset siblings stay null rather than becoming '' — every event other than
    // the Creative Expo has all four pairs absent.
    expect(parsed.row.admission_note).toBeNull();
    expect(parsed.row.travel_note).toBeNull();
    expect(parsed.row.lineup_note).toBeNull();
  });
});

describe("planEventSeed", () => {
  it("planEventSeed_prunes_removed_brands: existing row absent from the file is deleted", () => {
    const result = plan([{ slug: "kinyo-ceramics" }], [BRAND_ID_A, BRAND_ID_B]);

    expect(result.deleteBrandIds).toEqual([BRAND_ID_B]);
    expect(result.upsertRows.map((row) => row.brand_id)).toEqual([BRAND_ID_A]);
    expect(result.insertCount).toBe(0);
    expect(result.updateCount).toBe(1);
  });

  it("planEventSeed_absent_brands_key_prunes_nothing: [] prunes all", () => {
    const absent = plan(undefined, [BRAND_ID_A, BRAND_ID_B]);
    expect(absent.deleteBrandIds).toEqual([]);
    expect(absent.upsertRows).toEqual([]);

    const empty = plan([], [BRAND_ID_A, BRAND_ID_B]);
    expect(empty.deleteBrandIds).toEqual([BRAND_ID_A, BRAND_ID_B]);
    expect(empty.upsertRows).toEqual([]);
  });

  it("reports unknown brand slugs instead of writing them", () => {
    const result = plan(
      [{ slug: "kinyo-ceramics" }, { slug: "not-a-real-brand" }],
      [],
    );

    expect(result.unknownBrandSlugs).toEqual(["not-a-real-brand"]);
    expect(result.upsertRows.map((row) => row.brand_id)).toEqual([BRAND_ID_A]);
    expect(result.insertCount).toBe(1);
  });

  it("planEventSeed_unknown_slug_prunes_nothing: an unresolvable slug never deletes a live row", () => {
    // The brand may simply have been renamed (this repo has four
    // brand_slug_redirects migrations). Its id never lands in `keep`, so a
    // slug-keyed prune would delete a still-valid curated row — booth, area,
    // note and sort_order gone — on the strength of a stale slug. An unresolved
    // slug means the file's intent is unknown, not that the row was removed.
    const result = plan(
      [{ slug: "kinyo-ceramics" }, { slug: "renamed-brand" }],
      [BRAND_ID_A, BRAND_ID_B],
    );

    expect(result.unknownBrandSlugs).toEqual(["renamed-brand"]);
    expect(result.deleteBrandIds).toEqual([]);
    // The resolvable half still writes; only the prune is withheld.
    expect(result.upsertRows.map((row) => row.brand_id)).toEqual([BRAND_ID_A]);
  });
});

describe("event exhibitor ledger", () => {
  it("requires exactly one terminal outcome and matching report coverage", () => {
    const parsed = parseExhibitorLedger("ledger.json", ledgerRaw());
    expect(parsed.exhibitors).toHaveLength(4);
    expect(parsed.exhibitors[0]?.sourceKey).toBe("creative-expo:322");
    expect(exhibitorCoverage(parsed.exhibitors)).toMatchObject({
      byZone: { K1: 1, K2: 1, K3: 1, S: 1 },
      total: 4,
    });
    expect(() =>
      parseExhibitorLedger("bad-outcome.json", {
        ...ledgerRaw(),
        exhibitors: [
          ...(ledgerRaw().exhibitors as unknown[]).slice(0, 3),
          {
            ...((ledgerRaw().exhibitors as unknown[])[3] as Record<
              string,
              unknown
            >),
            outcome: "included_unlinked",
          },
        ],
      }),
    ).toThrow(/S rows must be matched_existing or out_of_scope/);
  });

  it("rejects an unrecognized terminal outcome", () => {
    const raw = ledgerRaw();
    const [first, ...rest] = raw.exhibitors as Record<string, unknown>[];
    if (!first) throw new Error("missing ledger fixture");

    expect(() =>
      parseExhibitorLedger("unknown-outcome.json", {
        ...raw,
        exhibitors: [{ ...first, outcome: "needs-human-decision" }, ...rest],
      }),
    ).toThrow(/must be exactly one of/);
  });

  it("rejects missing metadata on an included row", () => {
    const raw = ledgerRaw();
    const [first, second, ...rest] = raw.exhibitors as Record<
      string,
      unknown
    >[];
    if (!first || !second) throw new Error("missing ledger fixture");

    expect(() =>
      parseExhibitorLedger("missing-metadata.json", {
        ...raw,
        exhibitors: [first, { ...second, booth: null }, ...rest],
      }),
    ).toThrow(/included_unlinked requires/);
  });

  it("rejects out-of-scope outcomes in K zones", () => {
    const raw = ledgerRaw();
    const [first, ...rest] = raw.exhibitors as Record<string, unknown>[];
    if (!first) throw new Error("missing ledger fixture");

    expect(() =>
      parseExhibitorLedger("k-zone-scope.json", {
        ...raw,
        exhibitors: [
          { ...first, outcome: "out_of_scope", brandSlug: null },
          ...rest,
        ],
      }),
    ).toThrow(/K1\/K2\/K3 rows must be matched_existing or included_unlinked/);
  });

  it("rejects report checkpoints that drift from ledger coverage", () => {
    const raw = ledgerRaw();

    expect(() =>
      parseExhibitorLedger("wrong-checkpoint.json", {
        ...raw,
        reportTimeEvidence: {
          ...raw.reportTimeEvidence,
          checkpoint: { ...raw.reportTimeEvidence.checkpoint, K1: 2 },
        },
      }),
    ).toThrow(/coverage mismatch for K1/);
  });

  it("does not plan excluded or out-of-scope rows for persistence", () => {
    const raw = ledgerRaw();
    const [first, second, third, fourth] = raw.exhibitors as Record<
      string,
      unknown
    >[];
    if (!first || !second || !third || !fourth) {
      throw new Error("missing ledger fixture");
    }
    const excluded = {
      ...fourth,
      sourceKey: "creative-expo:other",
      booth: "OTHER-001",
      zone: "other",
      eventCategory: "other",
      sortOrder: 4,
      outcome: "excluded",
      brandSlug: null,
    };
    const parsed = parseExhibitorLedger("persistence-filter.json", {
      ...raw,
      exhibitors: [first, second, third, fourth, excluded],
    });
    const plan = planEventExhibitorSeed({
      eventSlug: parsed.eventSlug,
      eventId: EVENT_ID,
      ledger: parsed,
      brandIdsBySlug: new Map([["woky", BRAND_ID_A]]),
      existingExhibitors: [],
      existingBrandLinks: [],
    });

    expect(plan.exhibitorRows).toHaveLength(3);
    expect(plan.exhibitorRows.map((row) => row.source_key)).toEqual([
      first.sourceKey,
      second.sourceKey,
      third.sourceKey,
    ]);
    expect(plan.exhibitorRows.map((row) => row.source_key)).not.toContain(
      "creative-expo:325",
    );
    expect(plan.exhibitorRows.map((row) => row.source_key)).not.toContain(
      "creative-expo:other",
    );
  });

  it("disables pruning when a matched brand cannot be resolved", () => {
    const parsed = parseExhibitorLedger("ledger.json", ledgerRaw());
    const plan = planEventExhibitorSeed({
      eventSlug: parsed.eventSlug,
      eventId: EVENT_ID,
      ledger: parsed,
      brandIdsBySlug: new Map(),
      existingExhibitors: [
        { id: "6b1c9f2e-0000-4000-8000-0000000000e1", source_key: "OLD-001" },
      ],
      existingBrandLinks: [
        {
          id: "6b1c9f2e-0000-4000-8000-0000000000e2",
          brand_id: BRAND_ID_A,
          event_exhibitor_id: "6b1c9f2e-0000-4000-8000-0000000000e1",
          booth: "OLD-001",
        },
      ],
    });

    expect(plan.safeToPrune).toBe(false);
    expect(plan.deleteEventBrandIds).toEqual([]);
    expect(plan.deleteExhibitorIds).toEqual([]);
    expect(plan.unknownBrandSlugs).toEqual(["woky"]);
  });

  it("plans the same canonical identities idempotently", () => {
    const parsed = parseExhibitorLedger("ledger.json", ledgerRaw());
    const existingExhibitors = parsed.exhibitors
      .filter(
        (row) =>
          row.outcome === "matched_existing" ||
          row.outcome === "included_unlinked",
      )
      .map((row, index) => ({
        id: `6b1c9f2e-0000-4000-8000-0000000000${index + 1}`,
        source_key: row.sourceKey,
      }));
    const plan = () =>
      planEventExhibitorSeed({
        eventSlug: parsed.eventSlug,
        eventId: EVENT_ID,
        ledger: parsed,
        brandIdsBySlug: new Map([["woky", BRAND_ID_A]]),
        existingExhibitors,
        existingBrandLinks: [],
      });

    expect(plan()).toEqual(plan());
    expect(plan().deleteEventBrandIds).toEqual([]);
    expect(plan().deleteExhibitorIds).toEqual([]);
  });

  it("prunes stale links by exact exhibitor-brand pair", () => {
    const parsed = parseExhibitorLedger("ledger.json", ledgerRaw());
    const existingExhibitors = parsed.exhibitors.map((row, index) => ({
      id: `6b1c9f2e-0000-4000-8000-0000000000${index + 1}`,
      source_key: row.sourceKey,
    }));
    const staleExhibitor = existingExhibitors.find(
      (row) => row.source_key === "creative-expo:323",
    );
    if (!staleExhibitor) throw new Error("missing stale exhibitor fixture");
    const plan = planEventExhibitorSeed({
      eventSlug: parsed.eventSlug,
      eventId: EVENT_ID,
      ledger: parsed,
      brandIdsBySlug: new Map([["woky", BRAND_ID_A]]),
      existingExhibitors,
      existingBrandLinks: [
        {
          id: "6b1c9f2e-0000-4000-8000-0000000000f1",
          brand_id: BRAND_ID_A,
          event_exhibitor_id: staleExhibitor.id,
          booth: "K2-001",
        },
      ],
    });

    expect(plan.deleteEventBrandIds).toEqual([
      "6b1c9f2e-0000-4000-8000-0000000000f1",
    ]);
  });
});
