import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCategoryPeerStats } from "../brand-peer-stats";

type BrandRow = {
  id: string;
  price_range: number | null;
  city: string | null;
  status: string;
  name: string;
  category: string | null;
};

function createClientDouble(rows: BrandRow[], queryError: Error | null = null) {
  const selectCalls: string[] = [];
  const eqCalls: Array<[string, unknown]> = [];
  const notCalls: Array<[string, string, string]> = [];

  return {
    client: {
      from(table: string) {
        expect(table).toBe("brands");
        const filters: Array<(row: BrandRow) => boolean> = [];
        const builder = {
          select(columns: string) {
            selectCalls.push(columns);
            return builder;
          },
          eq(column: string, value: unknown) {
            eqCalls.push([column, value]);
            if (column === "status" || column === "category") {
              filters.push(
                (row) => row[column as keyof BrandRow] === value,
              );
            }
            return builder;
          },
          not(column: string, operator: string, value: string) {
            notCalls.push([column, operator, value]);
            if (column === "name" && operator === "like") {
              const prefix = value.endsWith("%") ? value.slice(0, -1) : value;
              filters.push((row) => !row.name.startsWith(prefix));
            }
            return builder;
          },
          then(
            resolve: (result: {
              data: BrandRow[] | null;
              error: Error | null;
            }) => unknown,
          ) {
            const data = rows.filter((row) => filters.every((filter) => filter(row)));
            return Promise.resolve(resolve({ data, error: queryError }));
          },
        };
        return builder;
      },
    } as unknown as Pick<SupabaseClient, "from">,
    selectCalls,
    eqCalls,
    notCalls,
  };
}

function row(overrides: Partial<BrandRow> & Pick<BrandRow, "id">): BrandRow {
  // `id` is supplied only by the spread: `overrides` is `Pick<BrandRow, "id">`,
  // so it is always present and listing it again would just be overwritten.
  return {
    price_range: null,
    city: null,
    status: "approved",
    name: `Brand ${overrides.id}`,
    category: "home",
    ...overrides,
  };
}

describe("getCategoryPeerStats", () => {
  it("counts only approved brands in the category", async () => {
    const double = createClientDouble([
      row({ id: "subject", price_range: 2, city: "Taipei" }),
      row({ id: "approved-peer", price_range: 1, city: "Taichung" }),
      row({ id: "hidden-peer", status: "hidden", price_range: 3, city: "Tainan" }),
      row({ id: "other-category", category: "fashion", price_range: 2, city: "Hsinchu" }),
    ]);

    const result = await getCategoryPeerStats("home", "subject", double.client);

    expect(double.selectCalls).toEqual(["id, price_range, city"]);
    expect(double.eqCalls).toEqual([
      ["status", "approved"],
      ["category", "home"],
    ]);
    expect(result?.peerCount).toBe(1);
  });

  it("excludes the subject brand from its own peer set", async () => {
    const double = createClientDouble([
      row({ id: "subject", price_range: 2, city: "Taipei" }),
      row({ id: "peer", price_range: 2, city: "Taipei" }),
    ]);

    const result = await getCategoryPeerStats("home", "subject", double.client);

    expect(result).toEqual({
      peerCount: 1,
      priceDistribution: { 1: 0, 2: 1, 3: 0 },
      cityClusters: [{ city: "Taipei", count: 1 }],
    });
  });

  it("returns price-range distribution across the category", async () => {
    const double = createClientDouble([
      row({ id: "subject", price_range: 1, city: "Taipei" }),
      row({ id: "peer-1", price_range: 1, city: "Taipei" }),
      row({ id: "peer-2", price_range: 2, city: "Taichung" }),
      row({ id: "peer-3", price_range: 3, city: "Tainan" }),
      row({ id: "peer-4", price_range: null, city: null }),
    ]);

    const result = await getCategoryPeerStats("home", "subject", double.client);

    expect(result?.priceDistribution).toEqual({ 1: 1, 2: 1, 3: 1 });
  });

  it("returns null for a brand with no category", async () => {
    const double = createClientDouble([]);

    await expect(
      getCategoryPeerStats(null, "subject", double.client),
    ).resolves.toBeNull();
    await expect(
      getCategoryPeerStats(undefined, "subject", double.client),
    ).resolves.toBeNull();
    await expect(
      getCategoryPeerStats("", "subject", double.client),
    ).resolves.toBeNull();
    expect(double.selectCalls).toHaveLength(0);
  });

  it("throws the database error", async () => {
    const databaseError = new Error("category read failed");
    const double = createClientDouble([], databaseError);

    await expect(
      getCategoryPeerStats("home", "subject", double.client),
    ).rejects.toBe(databaseError);
  });

  it("applies the public test-brand exclusion", async () => {
    const double = createClientDouble([
      row({ id: "subject" }),
      row({ id: "test", name: "[E2E-TEST] fixture" }),
      row({ id: "peer" }),
    ]);

    const result = await getCategoryPeerStats("home", "subject", double.client);

    expect(double.notCalls).toEqual([["name", "like", "[E2E-TEST]%"]]);
    expect(result?.peerCount).toBe(1);
  });
});
