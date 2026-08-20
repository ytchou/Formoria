import { describe, expect, it, vi } from "vitest";
import {
  applyPublicStockistVisibility,
  CHAIN_REGION_LABEL,
  groupStockistsByRegion,
  groupStockistsForDisplay,
  normalizeStockistName,
  PENDING_COMMUNITY_EXCLUSION,
} from "./stockist-display";
import type { Stockist } from "@/lib/types/stockist";

type StockistDisplayRow = {
  id: string;
  name: string;
  regionLabel: string | null;
  address: string | null;
  url: string | null;
  sourceUrl?: string | null;
  fetchedAt?: string | null;
  locationType?: string | null;
  country?: string | null;
  ownerStatus: string;
  ownerStatusBy?: string | null;
  source: string;
  removedAt: string | null;
};

function stockistDisplayRow(overrides: Partial<StockistDisplayRow> = {}): StockistDisplayRow {
  return {
    id: "stockist-1",
    name: "登山友",
    regionLabel: null,
    address: null,
    url: null,
    ownerStatus: "none",
    source: "backfill",
    removedAt: null,
    ...overrides,
  };
}

describe("groupStockistsForDisplay", () => {
  it("promotes an owner-confirmed row to confirmed", () => {
    const result = groupStockistsForDisplay(
      [stockistDisplayRow({ ownerStatus: "confirmed", ownerStatusBy: "owner-user" })],
      ["owner-user"],
    );

    expect(result.confirmed).toEqual([
      expect.objectContaining({
        status: "confirmed",
        confirmedBy: "owner",
      }),
    ]);
    expect(result.confirmed.at(0)).not.toHaveProperty("confirmationCount");
    expect(result.possible).toEqual([]);
  });

  // `owner_status_by` is null on every row the 2026-07 backfill promoted out of
  // `brands.retail_locations`. Those WERE owner confirmations, so an unknown
  // approver keeps the owner claim; only a positively identified non-owner
  // downgrades it (see `stockist-queue.test.ts`).
  it("keeps owner provenance when no approver was recorded", () => {
    const result = groupStockistsForDisplay([
      stockistDisplayRow({ ownerStatus: "confirmed", ownerStatusBy: null }),
    ]);

    expect(result.confirmed.at(0)).toMatchObject({ confirmedBy: "owner" });
  });

  it("promotes an evidence-backed row to confirmed", () => {
    const result = groupStockistsForDisplay([
      stockistDisplayRow({
        source: "import",
        sourceUrl: "https://hanchor.com.tw/pages/stockists",
      }),
    ]);

    expect(result.confirmed.at(0)).toMatchObject({
      status: "confirmed",
      confirmedBy: "evidence",
      evidenceSource: "official_website",
    });
  });

  // Only the curated import guarantees the evidence is the brand's own site, so
  // every other evidence-backed source must not claim it.
  it("marks non-import evidence as a generic source, not the official website", () => {
    const result = groupStockistsForDisplay([
      stockistDisplayRow({
        source: "enriched",
        sourceUrl: "https://www.example-directory.tw/shops/1",
      }),
    ]);

    expect(result.confirmed.at(0)).toMatchObject({
      status: "confirmed",
      confirmedBy: "evidence",
      evidenceSource: "other",
    });
  });

  it("leaves evidenceSource unset when nothing backs the row", () => {
    const result = groupStockistsForDisplay([
      stockistDisplayRow({ ownerStatus: "confirmed", sourceUrl: null }),
    ]);

    expect(result.confirmed.at(0)).toMatchObject({ confirmedBy: "owner" });
    expect(result.confirmed.at(0)?.evidenceSource).toBeUndefined();
  });

  it("does not send the evidence source URL to the client", () => {
    const result = groupStockistsForDisplay([
      stockistDisplayRow({
        source: "import",
        sourceUrl: "https://hanchor.com.tw/pages/stockists",
      }),
    ]);

    expect(result.confirmed.at(0)).not.toHaveProperty("sourceUrl");
  });

  // LOAD-BEARING. `evidenceBacked` is `sourceUrl != null && source !== "community"`,
  // and dropping the second operand would promote every community row carrying a
  // URL to "confirmed" on 718 live brand pages.
  it("does not treat a community row with a source URL as evidence backed", () => {
    const result = groupStockistsForDisplay([
      stockistDisplayRow({
        source: "community",
        sourceUrl: "https://example.com/community-submission",
      }),
    ]);

    expect(result.possible.at(0)).toMatchObject({ status: "unconfirmed" });
  });

  it("normalizeStockistName strips whitespace, case, and retailer noise suffixes", () => {
    expect(normalizeStockistName("登山友 店")).toBe(
      normalizeStockistName("登山友"),
    );
    expect(normalizeStockistName("登山友\t店")).toBe(
      normalizeStockistName("登山友"),
    );
    expect(normalizeStockistName("登山友 內湖店")).not.toBe(
      normalizeStockistName("登山友"),
    );
    expect(normalizeStockistName("登山友")).not.toBe(
      normalizeStockistName("登山王"),
    );
  });

  it("normalizeStockistName strips compound suffixes sequentially", () => {
    // '登山友門市專賣店': strip '專賣店' → '登山友門市', then strip '門市' → '登山友'
    expect(normalizeStockistName("登山友門市專賣店")).toBe("登山友");
    // Should NOT return '登山友門市' (the old single-pass behaviour)
    expect(normalizeStockistName("登山友門市專賣店")).not.toBe("登山友門市");
    // Stripping must not reduce to empty string: '店' alone stays '店'
    expect(normalizeStockistName("店")).toBe("店");
  });

  it("excludes tombstoned and rejected stockists from both groups", () => {
    const result = groupStockistsForDisplay([
      stockistDisplayRow({ id: "removed", removedAt: "2026-07-24T00:00:00Z" }),
      stockistDisplayRow({ id: "rejected", ownerStatus: "rejected" }),
    ]);

    expect(result).toEqual({ confirmed: [], possible: [] });
  });

});

/**
 * Structurally satisfies the `applyPublicStockistVisibility` constraint without
 * any Supabase machinery — the real `PostgrestFilterBuilder` also returns itself
 * from each of these. `check-test-boundaries.mjs` forbids mocking the client, so
 * a spy is the only way to assert the emitted filters directly.
 */
function createQuerySpy() {
  const calls: string[] = [];
  const query = {
    calls,
    is(column: string, value: null) {
      calls.push(`is(${column},${String(value)})`);
      return query;
    },
    neq(column: string, value: string) {
      calls.push(`neq(${column},${value})`);
      return query;
    },
    or(filters: string) {
      calls.push(`or(${filters})`);
      return query;
    },
  };
  return query;
}

describe("applyPublicStockistVisibility", () => {
  it("hides tombstoned, owner-rejected, and unreviewed community rows", () => {
    const query = createQuerySpy();

    applyPublicStockistVisibility(query);

    expect(query.calls).toEqual([
      "is(removed_at,null)",
      "neq(owner_status,rejected)",
      "or(source.neq.community,owner_status.neq.none)",
    ]);
  });

  // De Morgan of `source = 'community' AND owner_status = 'none'`. Both columns
  // are NOT NULL, so the negation has no null hole to fall through.
  it("excludes exactly the community rows with no decision on them", () => {
    expect(PENDING_COMMUNITY_EXCLUSION).toBe(
      "source.neq.community,owner_status.neq.none",
    );
  });

  it("returns the same query so it stays chainable", () => {
    const query = createQuerySpy();

    expect(applyPublicStockistVisibility(query)).toBe(query);
  });
});

describe("groupStockistsByRegion", () => {
  function stockist(overrides: Partial<Stockist> = {}): Stockist {
    return {
      id: "stockist-1",
      name: "通路",
      regionLabel: null,
      address: null,
      url: null,
      ownerStatus: "none",
      source: "community",
      status: "unconfirmed",
      ...overrides,
    };
  }

  it("groups Taiwan rows by canonical region ordered by count", () => {
    const groups = groupStockistsByRegion([
      stockist({
        id: "taipei-one",
        name: "臺北一店",
        regionLabel: "臺北市",
        country: "TW",
      }),
      stockist({
        id: "taichung",
        name: "臺中店",
        regionLabel: "臺中市",
        country: "TW",
      }),
      stockist({
        id: "taipei-two",
        name: "臺北二店",
        regionLabel: "臺北市",
        country: "TW",
      }),
    ]);

    expect(groups.map((group) => [group.key, group.stockists.length])).toEqual([
      ["taipei", 2],
      ["taichung", 1],
    ]);
  });

  it("collapses non-Taiwan rows into one overseas group", () => {
    const groups = groupStockistsByRegion([
      stockist({
        id: "hong-kong",
        name: "香港店",
        regionLabel: "香港",
        country: "HK",
      }),
      stockist({
        id: "new-york",
        name: "紐約店",
        regionLabel: "美國・New York",
        country: "US",
      }),
    ]);

    expect(groups).toEqual([expect.objectContaining({ key: "overseas" })]);
    expect(groups.at(0)?.stockists).toHaveLength(2);
  });

  // Every stockist is a physical place since DEV-1513 dropped the sales-format
  // column, so there is no "online" bucket left to fall into. A row lands in a
  // city, in `all_taiwan` when it carries the chain sentinel, or in `overseas` —
  // including a row with no region at all, which is the fallback branch and not
  // a fourth category.
  it("groups stockists by region without an online bucket", () => {
    const groups = groupStockistsByRegion([
      stockist({ id: "unlocated", name: "官方商城" }),
      stockist({
        id: "taipei",
        name: "臺北店",
        regionLabel: "臺北市",
        country: "TW",
      }),
      stockist({
        id: "chain",
        name: "全台連鎖",
        regionLabel: CHAIN_REGION_LABEL,
        country: "TW",
      }),
      stockist({
        id: "hong-kong",
        name: "香港店",
        regionLabel: "香港",
        country: "HK",
      }),
    ]);

    expect(groups.map((group) => [group.key, group.stockists.length])).toEqual([
      ["overseas", 2],
      ["all_taiwan", 1],
      ["taipei", 1],
    ]);
  });

  it("keeps Chinese stockist order stable across runtime locale differences", () => {
    const localeCompare = vi
      .spyOn(String.prototype, "localeCompare")
      .mockImplementation(function (this: string, compareString: string) {
        return this.toString() < compareString ? 1 : -1;
      });

    try {
      const groups = groupStockistsByRegion([
        stockist({ id: "shoe-store", name: "美仕鞋行", regionLabel: "新北市" }),
        stockist({ id: "shoe-shop", name: "萬花筒鞋舖", regionLabel: "新北市" }),
      ]);

      expect(groups.at(0)?.stockists.map(({ name }) => name)).toEqual([
        "美仕鞋行",
        "萬花筒鞋舖",
      ]);
    } finally {
      localeCompare.mockRestore();
    }
  });
});
