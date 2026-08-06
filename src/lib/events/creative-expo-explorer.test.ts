import { describe, expect, it } from "vitest";

import type { PublicBrandCard } from "@/lib/brands/contracts";
import type { EventExhibitorEntry } from "@/lib/services/events";
import {
  buildCreativeExpoUrl,
  deriveCreativeExpoZoneCounts,
  deriveCreativeExpoHighlightedZones,
  filterCreativeExpoEntries,
  getCreativeExpoSearchFields,
  parseCreativeExpoUrlState,
  projectLinkedCreativeExpoEntries,
  resetCreativeExpoFilters,
  resetCreativeExpoZone,
  selectLinkedCreativeExpoEntries,
  sortCreativeExpoEntries,
  verifyCreativeExpoPlacement,
  type CreativeExpoExplorerState,
} from "./creative-expo-explorer";

function brand(name: string, category = "crafts"): PublicBrandCard {
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
    category,
    isVerified: false,
    mitStatus: "unverified",
    priceRange: null,
    productTags: [],
    productTagsEn: [],
    foundingYear: null,
    productPhotos: [],
    imageAlts: [],
    heroImageMetadata: null,
  };
}

function entry(
  overrides: Partial<EventExhibitorEntry> = {},
): EventExhibitorEntry {
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
    brand: brand("沃廚"),
    ...overrides,
  };
}

const linked = [
  entry(),
  entry({
    id: "exhibitor-2",
    sourceKey: "creative-expo:2",
    name: "山房",
    nameEn: "Mountain House",
    booth: "K2-010",
    zone: "K2",
    sortOrder: 1,
    brand: brand("山房", "homeware"),
  }),
  entry({
    id: "exhibitor-3",
    sourceKey: "creative-expo:3",
    name: "No card",
    booth: "K3-003",
    zone: "K3",
    sortOrder: 2,
    brand: null,
  }),
  entry({
    id: "exhibitor-4",
    sourceKey: "creative-expo:4",
    name: "IP only",
    booth: "J2-014",
    zone: "J2",
    sortOrder: 3,
    brand: brand("IP only"),
  }),
];

describe("Creative Expo explorer state", () => {
  it("keeps only linked core-zone exhibitors and projects them to cards", () => {
    const selected = selectLinkedCreativeExpoEntries(linked);

    expect(selected.map((item) => item.id)).toEqual([
      "exhibitor-1",
      "exhibitor-2",
    ]);
    expect(projectLinkedCreativeExpoEntries(selected)).toMatchObject([
      {
        brand: { name: "沃廚" },
        booth: "K1-001",
        area: "文創品牌展區",
        zone: "K1",
        eventCategory: "cultural_creative",
      },
      {
        brand: { name: "山房" },
        booth: "K2-010",
        area: "文創品牌展區",
        zone: "K2",
        eventCategory: "cultural_creative",
      },
    ]);
  });

  it("treats canonical zone as truth while reporting booth disagreement", () => {
    const mismatched = entry({ zone: "K2", booth: "K1-099" });
    const selected = selectLinkedCreativeExpoEntries([mismatched]);
    expect(selected).toHaveLength(1);
    expect(verifyCreativeExpoPlacement(selected[0]!)).toEqual({
      canonicalZone: "K2",
      boothZone: "K1",
      consistent: false,
    });
  });

  it("composes zone, category, and expanded search as AND filters", () => {
    const entries = selectLinkedCreativeExpoEntries([
      entry(),
      entry({
        id: "exhibitor-2",
        zone: "K2",
        booth: "K2-010",
        nameEn: "Mountain House",
        brand: { ...brand("山房", "homeware"), romanizedName: "Shanfang" },
      }),
    ]);
    const state: CreativeExpoExplorerState = {
      zone: "K2",
      category: "homeware",
      query: "shanfang",
      sort: "recommended",
      expanded: false,
      mobilePanel: "list",
    };

    expect(
      filterCreativeExpoEntries(entries, state).map((item) => item.id),
    ).toEqual(["exhibitor-2"]);
    expect(getCreativeExpoSearchFields(entries[1]!)).toEqual(
      expect.arrayContaining(["山房", "Shanfang", "Mountain House", "K2-010"]),
    );
  });

  it("derives contextual counts and highlights before selected zone", () => {
    const entries = selectLinkedCreativeExpoEntries([
      entry(),
      entry({ id: "exhibitor-2", zone: "K2", brand: brand("山房", "crafts") }),
      entry({ id: "exhibitor-3", zone: "S", brand: brand("小店", "homeware") }),
    ]);
    const state: CreativeExpoExplorerState = {
      zone: "K2",
      category: "crafts",
      query: "",
      sort: "recommended",
      expanded: false,
      mobilePanel: "map",
    };

    expect(deriveCreativeExpoZoneCounts(entries, state)).toEqual({
      K1: 1,
      K2: 1,
      K3: 0,
      S: 0,
    });
    expect(
      deriveCreativeExpoHighlightedZones(entries, { ...state, zone: null }),
    ).toEqual(["K1", "K2"]);
    expect(deriveCreativeExpoHighlightedZones(entries, state)).toEqual([]);
  });

  it("allowlists URL zone and category values and resets all filters", () => {
    expect(
      parseCreativeExpoUrlState(
        new URLSearchParams("zone=K2&category=homeware&query=ignored"),
        ["K1", "K2"],
        ["crafts", "homeware"],
      ),
    ).toEqual({ zone: "K2", category: "homeware" });
    expect(
      parseCreativeExpoUrlState(
        new URLSearchParams("zone=J2&category=unknown"),
        ["K1", "K2"],
        ["crafts", "homeware"],
      ),
    ).toEqual({ zone: null, category: null });

    const url = new URL(
      "https://formoria.test/en/events/creative?ref=story#explore",
    );
    buildCreativeExpoUrl(url, { zone: "K1", category: "crafts" });
    expect(url.toString()).toBe(
      "https://formoria.test/en/events/creative?ref=story&zone=K1&category=crafts#explore",
    );
    buildCreativeExpoUrl(url, { zone: null, category: null });
    expect(url.toString()).toBe(
      "https://formoria.test/en/events/creative?ref=story#explore",
    );

    const state: CreativeExpoExplorerState = {
      zone: "K2",
      category: "crafts",
      query: "ceramic",
      sort: "booth",
      expanded: true,
      mobilePanel: "list",
    };
    expect(resetCreativeExpoFilters(state)).toMatchObject({
      zone: null,
      category: null,
      query: "",
    });
    expect(resetCreativeExpoZone(state)).toMatchObject({
      zone: null,
      category: "crafts",
    });
  });

  it("hydrates canonical category URLs against legacy stored values", () => {
    expect(
      parseCreativeExpoUrlState(
        new URLSearchParams("zone=K2&category=crafts"),
        ["K1", "K2"],
        ["工藝文創", "homeware"],
      ),
    ).toEqual({ zone: "K2", category: "工藝文創" });

    const url = new URL("https://formoria.test/en/events/creative");
    buildCreativeExpoUrl(url, { zone: "K2", category: "工藝文創" });
    expect(url.search).toBe("?zone=K2&category=crafts");
  });

  it("sorts by natural booth number without changing recommended order", () => {
    const entries = selectLinkedCreativeExpoEntries([
      entry({ id: "late", booth: "K1-011-05", sortOrder: 0 }),
      entry({ id: "early", booth: "K1-004", sortOrder: 1 }),
      entry({ id: "unknown", booth: null, sortOrder: 2 }),
    ]);
    expect(
      sortCreativeExpoEntries(entries, "booth").map((item) => item.id),
    ).toEqual(["early", "late", "unknown"]);
    expect(sortCreativeExpoEntries(entries, "recommended")).toBe(entries);
  });
});
