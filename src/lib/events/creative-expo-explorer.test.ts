import { describe, expect, it } from "vitest";

import type { PublicBrandCard } from "@/lib/brands/contracts";
import type { CreativeExpoEntry } from "@/lib/services/events";
import {
  buildCreativeExpoUrl,
  countCreativeExpoListed,
  deriveCreativeExpoZoneCounts,
  filterCreativeExpoEntries,
  getCreativeExpoSearchFields,
  paginateCreativeExpoEntries,
  parseCreativeExpoUrlState,
  resetCreativeExpoFilters,
  sortCreativeExpoEntries,
  verifyCreativeExpoPlacement,
  type CreativeExpoExplorerState,
} from "./creative-expo-explorer";

function brand(name: string, category = "home"): PublicBrandCard {
  return {
    id: name,
    name,
    slug: name.toLowerCase().replaceAll(" ", "-"),
    romanizedName: null,
    description: null,
    descriptionEn: null,
    blurb: null,
    blurbEn: null,
    heroImageUrl: null,
    status: "approved",
    categorySlug: category,
    categoryLabel: category,
    isVerified: false,
    mitStatus: "unverified",
    priceRange: null,
    subcategories: [],
    subcategoriesEn: [],
    foundingYear: null,
    productPhotos: [],
    imageAlts: [],
    heroImageMetadata: null,
  };
}

function entry(overrides: Partial<CreativeExpoEntry> = {}): CreativeExpoEntry {
  return {
    id: "exhibitor-1",
    eventId: "event-1",
    sourceKey: "creative-expo:1",
    name: "沃廚",
    nameEn: "WOKY",
    booth: "K1-001",
    area: "文創品牌展區",
    areaEn: "Cultural & Creative Brands",
    zone: "K1",
    eventCategory: "cultural_creative",
    sourceUrl: "https://example.com/exhibitor/1",
    websiteUrl: null,
    verifiedAt: "2026-08-06",
    sortOrder: 0,
    imageUrl: null,
    imageAltZh: null,
    imageAltEn: null,
    summaryZh: null,
    summaryEn: null,
    contentSource: null,
    contentVerifiedAt: null,
    brand: brand("沃廚"),
    ...overrides,
  };
}

describe("Creative Expo explorer state", () => {
  it("treats canonical zone as truth while reporting booth disagreement", () => {
    const mismatched = entry({ zone: "K2", booth: "K1-099" });
    expect(verifyCreativeExpoPlacement(mismatched)).toEqual({
      canonicalZone: "K2",
      boothZone: "K1",
      consistent: false,
    });
  });

  it("composes zone and search as AND filters across unlisted exhibitors", () => {
    const entries = [
      entry(),
      entry({
        id: "exhibitor-2",
        zone: "K2",
        booth: "K2-010",
        name: "山房",
        nameEn: "Mountain House",
        brand: null,
      }),
      entry({
        id: "exhibitor-3",
        zone: "K3",
        booth: "K3-010",
        name: "山房",
        nameEn: "Mountain House",
        brand: null,
      }),
    ];
    const base: CreativeExpoExplorerState = {
      zone: "K2",
      query: "",
      listedOnly: false,
      page: 1,
    };

    // An unlinked row is searchable on all three exhibitor fields.
    for (const query of ["山房", "mountain", "K2-010"]) {
      expect(
        filterCreativeExpoEntries(entries, { ...base, query }).map(
          (item) => item.id,
        ),
      ).toEqual(["exhibitor-2"]);
    }

    // `listedOnly` ANDs with the rest: exhibitor-2 matches the zone and the
    // query but has no Formoria brand page, so it drops out entirely.
    expect(
      filterCreativeExpoEntries(entries, {
        ...base,
        query: "山房",
        listedOnly: true,
      }),
    ).toEqual([]);
    expect(
      filterCreativeExpoEntries(entries, {
        zone: null,
        query: "",
        listedOnly: true,
      }).map((item) => item.id),
    ).toEqual(["exhibitor-1"]);

    expect(getCreativeExpoSearchFields(entries[1]!)).toEqual([
      "山房",
      "Mountain House",
      "K2-010",
    ]);
    expect(
      getCreativeExpoSearchFields(
        entry({ brand: { ...brand("山房"), romanizedName: "Shanfang" } }),
      ),
    ).toEqual(expect.arrayContaining(["Shanfang", "山房", "沃廚", "K1-001"]));
  });

  it("derives contextual counts before selected zone", () => {
    const entries = [
      entry(),
      entry({ id: "exhibitor-2", zone: "K2", brand: null }),
      entry({ id: "exhibitor-3", zone: "S", brand: brand("小店", "homeware") }),
    ];
    const state: CreativeExpoExplorerState = {
      zone: "K2",
      query: "",
      listedOnly: false,
      page: 1,
    };

    expect(deriveCreativeExpoZoneCounts(entries, state)).toEqual({
      K1: 1,
      K2: 1,
      K3: 0,
      S: 1,
    });
    // The listed filter narrows the chips too: exhibitor-2 carries no brand.
    expect(
      deriveCreativeExpoZoneCounts(entries, { ...state, listedOnly: true }),
    ).toEqual({ K1: 1, K2: 0, K3: 0, S: 1 });
    expect(countCreativeExpoListed(entries, { zone: null, query: "" })).toBe(2);
  });

  it("allowlists URL zone values and resets all filters", () => {
    expect(
      parseCreativeExpoUrlState(new URLSearchParams("zone=K2&query=ignored"), [
        "K1",
        "K2",
      ]),
    ).toEqual({ zone: "K2", query: null, listedOnly: false, page: 1 });
    expect(
      parseCreativeExpoUrlState(new URLSearchParams("zone=J2"), ["K1", "K2"]),
    ).toEqual({ zone: null, query: null, listedOnly: false, page: 1 });

    const url = new URL(
      "https://formoria.test/en/events/creative?ref=story#explore",
    );
    buildCreativeExpoUrl(url, { zone: "K1", listedOnly: true, page: 3 });
    expect(url.toString()).toBe(
      "https://formoria.test/en/events/creative?ref=story&zone=K1&listed=1&page=3#explore",
    );
    // Defaults are written as absence, so a cleared view leaves no params.
    buildCreativeExpoUrl(url, { zone: null, listedOnly: false, page: 1 });
    expect(url.toString()).toBe(
      "https://formoria.test/en/events/creative?ref=story#explore",
    );

    const state: CreativeExpoExplorerState = {
      zone: "K2",
      query: "ceramic",
      listedOnly: true,
      page: 4,
    };
    expect(resetCreativeExpoFilters(state)).toEqual({
      zone: null,
      query: "",
      listedOnly: false,
      page: 1,
    });
  });

  it("seeds a legacy booth link into the query and strips retired params", () => {
    expect(
      parseCreativeExpoUrlState(new URLSearchParams("booth=K2-022"), ["K2"]),
    ).toMatchObject({ query: "K2-022" });
    expect(
      parseCreativeExpoUrlState(new URLSearchParams("booth=nonsense"), ["K2"]),
    ).toMatchObject({ query: null });

    const url = new URL(
      "https://formoria.test/en/events/creative?booth=K2-022&category=home&ref=story",
    );
    buildCreativeExpoUrl(url, { zone: null, listedOnly: false, page: 1 });
    expect(url.search).toBe("?ref=story");
  });

  it("round-trips and clamps the page param", () => {
    expect(
      parseCreativeExpoUrlState(new URLSearchParams("page=5"), []),
    ).toMatchObject({ page: 5 });
    for (const search of ["page=0", "page=-3", "page=abc", ""]) {
      expect(
        parseCreativeExpoUrlState(new URLSearchParams(search), []),
      ).toMatchObject({ page: 1 });
    }
  });

  it("paginates by index window, clamping out-of-range pages", () => {
    const entries = Array.from({ length: 45 }, (_, index) =>
      entry({ id: `exhibitor-${index}` }),
    );

    expect(paginateCreativeExpoEntries(entries, 1, 20)).toEqual({
      pageCount: 3,
      startIndex: 0,
      endIndex: 20,
    });
    // Last page is partial: endIndex is the list length, not startIndex + size.
    expect(paginateCreativeExpoEntries(entries, 3, 20)).toEqual({
      pageCount: 3,
      startIndex: 40,
      endIndex: 45,
    });
    expect(paginateCreativeExpoEntries(entries, 9, 20)).toEqual({
      pageCount: 3,
      startIndex: 40,
      endIndex: 45,
    });
    expect(paginateCreativeExpoEntries(entries, 0, 20)).toEqual({
      pageCount: 3,
      startIndex: 0,
      endIndex: 20,
    });
    expect(paginateCreativeExpoEntries([], 1, 20)).toEqual({
      pageCount: 1,
      startIndex: 0,
      endIndex: 0,
    });
  });

  it("sorts by natural booth number without changing the server order", () => {
    const entries = [
      entry({ id: "late", booth: "K1-011-05", sortOrder: 0 }),
      entry({ id: "early", booth: "K1-004", sortOrder: 1 }),
      entry({ id: "unknown", booth: null, sortOrder: 2 }),
    ];
    expect(
      sortCreativeExpoEntries(entries, "booth").map((item) => item.id),
    ).toEqual(["early", "late", "unknown"]);
    // Identity, not a copy: the random branch must not re-roll per render.
    expect(sortCreativeExpoEntries(entries, "random")).toBe(entries);
  });
});
