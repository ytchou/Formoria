import { describe, expect, it, vi } from "vitest";
import {
  getPublishedCuratedProducts,
  type CatalogProductRow,
} from "../curated-products-catalog";

// ---------------------------------------------------------------------------
// Fake Supabase client that records calls and returns canned rows
// ---------------------------------------------------------------------------

function makeBrandRow(slug: string) {
  return {
    slug,
    name: `Brand ${slug}`,
    status: "approved",
    purchase_website: null,
    purchase_pinkoi: null,
    purchase_shopee: null,
    purchase_myship: null,
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
  };
}

function makeProductRow(
  id: string,
  overrides: Partial<CatalogProductRow> = {},
): CatalogProductRow {
  return {
    id,
    key: `key-${id}`,
    name_zh: `商品${id}`,
    name_en: `Product ${id}`,
    category: "home",
    subcategory: "candles",
    created_at: "2026-08-29T12:00:00.000Z",
    image_url: `https://example.com/${id}.jpg`,
    official_url: `https://example.com/${id}`,
    brands: makeBrandRow("brand-a"),
    ...overrides,
  };
}

type ChainableQuery = {
  [key: string]: (...args: unknown[]) => ChainableQuery;
};

function createFakeClient(rows: CatalogProductRow[]) {
  const calls: { method: string; args: unknown[] }[] = [];

  const chain = (): ChainableQuery => {
    const handler: ProxyHandler<object> = {
      get(_target, prop: string) {
        if (prop === "then") return undefined; // not thenable
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          if (prop === "range") {
            return Promise.resolve({ data: rows, error: null });
          }
          return new Proxy({}, handler);
        };
      },
    };
    return new Proxy({}, handler) as ChainableQuery;
  };

  const client = {
    from: vi.fn((_table: string) => chain()),
  };
  return { client, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getPublishedCuratedProducts with ids option", () => {
  it("returns rows in the caller's order and applies publication gates", async () => {
    // Rows arrive in id order (shuffled relative to the requested order)
    const rows = [
      makeProductRow("aaa"),
      makeProductRow("ccc"),
      makeProductRow("bbb"),
    ];
    const { client, calls } = createFakeClient(rows);

    const result = await getPublishedCuratedProducts(
      { ids: ["bbb", "ccc", "aaa"] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock client
      client as any,
    );

    // Output order follows the ids array, not the DB order
    expect(result.products.map((p) => p.id)).toEqual(["bbb", "ccc", "aaa"]);
    expect(result.totalCount).toBe(3);

    // .in("id", ids) was applied
    const inCall = calls.find((c) => c.method === "in");
    expect(inCall).toBeDefined();
    expect(inCall!.args).toEqual(["id", ["bbb", "ccc", "aaa"]]);

    // Publication gates still applied (visible, official_url, source_checked_at, brands.status)
    const eqCalls = calls.filter((c) => c.method === "eq");
    expect(eqCalls.some((c) => c.args[0] === "visible" && c.args[1] === true)).toBe(true);
    expect(eqCalls.some((c) => c.args[0] === "brands.status" && c.args[1] === "approved")).toBe(true);

    const notCalls = calls.filter((c) => c.method === "not");
    expect(notCalls.some((c) => c.args[0] === "official_url")).toBe(true);
    expect(notCalls.some((c) => c.args[0] === "source_checked_at")).toBe(true);

    // excludeTestBrands was applied (not like on brands.name)
    expect(notCalls.some((c) => c.args[0] === "brands.name" && c.args[1] === "like")).toBe(true);
  });

  it("returns empty list and totalCount 0 when no ids match", async () => {
    const { client } = createFakeClient([]);

    const result = await getPublishedCuratedProducts(
      { ids: ["nonexistent-1", "nonexistent-2"] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock client
      client as any,
    );

    expect(result.products).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it("ignores page and sort — returns all ids regardless", async () => {
    const rows = [
      makeProductRow("aaa"),
      makeProductRow("bbb"),
      makeProductRow("ccc"),
    ];
    const { client, calls } = createFakeClient(rows);

    // page=2 with pageSize=1 would normally slice to just one item
    const result = await getPublishedCuratedProducts(
      { ids: ["aaa", "bbb", "ccc"], page: 2, pageSize: 1, sort: "alphabetical" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock client
      client as any,
    );

    // All three returned — page is ignored in ids mode
    expect(result.products).toHaveLength(3);
    expect(result.totalCount).toBe(3);

    // No user-specified order call (only the id tiebreaker)
    const orderCalls = calls.filter((c) => c.method === "order");
    const userSortCalls = orderCalls.filter(
      (c) => c.args[0] === "name_zh" || c.args[0] === "created_at",
    );
    expect(userSortCalls).toHaveLength(0);
  });
});
