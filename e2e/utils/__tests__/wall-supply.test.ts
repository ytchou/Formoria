import { beforeEach, describe, expect, it, vi } from "vitest";

const skip = vi.fn();
vi.mock("@playwright/test", () => ({ test: { skip: (...args: unknown[]) => skip(...args) } }));

const trailFrontmatter = vi.fn<() => { heroImage?: string }[]>(() => []);
vi.mock("../published-trails", () => ({
  publishedTrails: () => trailFrontmatter(),
  NO_PUBLISHED_TRAILS: "no published trails in content/trails",
}));

import {
  MAX_HOME_WALL_PRODUCTS,
  MIN_HOME_CURATED_PRODUCTS,
  TRAIL_SLOT_CADENCE,
  requireWallOrSkip,
  requireWallTrailTileOrSkip,
  resetWallSupplyProbe,
  type WallSupplySupabase,
} from "../wall-supply";
import { TEST_BRAND_NAME_PATTERN } from "../../../src/lib/services/public-brand-filter";
import { MAX_HOME_CURATED_PRODUCTS_PER_BRAND } from "../../../src/lib/curated-products/wall-ratio";
import {
  MAX_HOME_WALL_PRODUCTS as SOURCE_MAX_HOME_WALL_PRODUCTS,
  TRAIL_SLOT_CADENCE as SOURCE_TRAIL_SLOT_CADENCE,
} from "../../../src/lib/curated-products/home-wall";

type CountResult = {
  count?: number | null;
  data?: unknown[];
  error: unknown;
};

/**
 * Minimal PostgREST double: every builder method chains and records the filter
 * it was given, and awaiting the builder resolves the count response the test
 * asked for. `curated_products` is the only table the guard reads.
 *
 * A LIST of results is answered one per query, so a test can make the first
 * count fail and the second succeed; the last entry repeats once exhausted.
 */
function supabaseReturning(
  ...results: (CountResult | Error)[]
): {
  client: WallSupplySupabase;
  calls: () => number;
  filters: () => string[];
} {
  let calls = 0;
  const filters: string[] = [];
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  for (const method of ["eq", "not", "limit"]) {
    builder[method] = (...args: unknown[]) => {
      filters.push(`${method}(${args.map(String).join(",")})`);
      return builder;
    };
  }
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => {
    const result = results[Math.min(calls - 1, results.length - 1)]!;
    return result instanceof Error
      ? Promise.reject(result).then(resolve, reject)
      : Promise.resolve(result).then(resolve, reject);
  };

  const client = {
    from: (table: string) => {
      calls += 1;
      filters.length = 0;
      expect(table).toBe("curated_products");
      return builder;
    },
  } as unknown as WallSupplySupabase;

  return { client, calls: () => calls, filters: () => filters };
}

describe("homepage wall supply guard", () => {
  beforeEach(() => {
    skip.mockClear();
    resetWallSupplyProbe();
  });

  it("throws when the wall is absent and supply is sufficient", async () => {
    const { client } = supabaseReturning({
      count: MIN_HOME_CURATED_PRODUCTS,
      error: null,
    });

    await expect(requireWallOrSkip(true, client)).rejects.toThrow(
      /selection zone is missing/,
    );
    expect(skip).not.toHaveBeenCalled();
  });

  it("skips when the wall is absent and supply is below the floor", async () => {
    const { client } = supabaseReturning({
      count: MIN_HOME_CURATED_PRODUCTS - 1,
      error: null,
    });

    await expect(requireWallOrSkip(true, client)).resolves.toBeUndefined();
    expect(skip).toHaveBeenCalledWith(true, expect.stringContaining("supply"));
  });

  it("skips when the supply query fails", async () => {
    // A transport or permission failure must never invent a regression: the
    // guard cannot tell supply from absence, so it declines to report red.
    const rejected = supabaseReturning(new Error("network down"));
    await expect(requireWallOrSkip(true, rejected.client)).resolves.toBeUndefined();
    expect(skip).toHaveBeenCalledTimes(1);

    resetWallSupplyProbe();
    skip.mockClear();
    const errored = supabaseReturning({
      count: null,
      error: { message: "permission denied for table curated_products" },
    });
    await expect(requireWallOrSkip(true, errored.client)).resolves.toBeUndefined();
    expect(skip).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the wall is present", async () => {
    const { client, calls } = supabaseReturning({ count: 0, error: null });

    await expect(requireWallOrSkip(false, client)).resolves.toBeUndefined();
    expect(skip).not.toHaveBeenCalled();
    // A present wall asks the database nothing — the count is only needed to
    // interpret an ABSENT wall.
    expect(calls()).toBe(0);
  });

  it("counts supply once per worker and reuses the answer", async () => {
    const { client, calls } = supabaseReturning({ count: 1, error: null });

    await requireWallOrSkip(true, client);
    await requireWallOrSkip(true, client);

    expect(calls()).toBe(1);
    expect(skip).toHaveBeenCalledTimes(2);
  });

  it("retries the count after a transient failure instead of caching it", async () => {
    // One Supabase timeout must not disarm the guard for the rest of the
    // worker: a cached `null` turns every later wall spec into a skip, which is
    // exactly how a real regression reports green.
    const { client, calls } = supabaseReturning(new Error("timeout"), {
      count: MIN_HOME_CURATED_PRODUCTS,
      error: null,
    });

    await expect(requireWallOrSkip(true, client)).resolves.toBeUndefined();
    expect(skip).toHaveBeenCalledTimes(1);

    await expect(requireWallOrSkip(true, client)).rejects.toThrow(
      /selection zone is missing/,
    );
    expect(calls()).toBe(2);
  });

  it("does not count products belonging to seeded test brands", async () => {
    // The service gate drops `[E2E-TEST]` brands and rows with no brand name.
    // A count that keeps them reports supply the homepage will never render,
    // and turns a legitimately hidden wall into a red.
    const { client, filters } = supabaseReturning({ count: 0, error: null });

    await requireWallOrSkip(true, client);

    expect(filters()).toContain(
      `not(brands.name,like,${TEST_BRAND_NAME_PATTERN})`,
    );
    expect(filters()).toContain("not(brands.name,is,null)");
  });
});

/** N eligible rows spread over one brand per argument. */
function rowsPerBrand(...perBrand: number[]): { brand_id: string }[] {
  return perBrand.flatMap((count, index) =>
    Array.from({ length: count }, () => ({ brand_id: `brand-${index}` })),
  );
}

const withHeroImage = [{ heroImage: "/images/trails/hero.jpg" }];

describe("homepage wall trail-tile guard", () => {
  beforeEach(() => {
    skip.mockClear();
    resetWallSupplyProbe();
    trailFrontmatter.mockReturnValue([]);
  });

  it("pins the duplicated wall constants to their source", () => {
    // These two are copied out of home-wall.ts because `e2e/` cannot resolve
    // the `@/` alias Playwright would need. Vitest CAN, so the copy is asserted
    // here rather than trusted — this is the whole safety net for that
    // duplication.
    expect(TRAIL_SLOT_CADENCE).toBe(SOURCE_TRAIL_SLOT_CADENCE);
    expect(MAX_HOME_WALL_PRODUCTS).toBe(SOURCE_MAX_HOME_WALL_PRODUCTS);
  });

  it("does nothing when the trail tile is present", async () => {
    const { client, calls } = supabaseReturning({ data: [], error: null });

    await expect(
      requireWallTrailTileOrSkip(false, client),
    ).resolves.toBeUndefined();
    expect(skip).not.toHaveBeenCalled();
    expect(calls()).toBe(0);
  });

  it("skips without touching the database when no trail carries a heroImage", async () => {
    // The live case as of DEV-1522: one published trail, no `heroImage`, so
    // `buildWallSlots` reserves no trail slot whatever the product supply is.
    trailFrontmatter.mockReturnValue([{}, { heroImage: "   " }]);
    const { client, calls } = supabaseReturning({ data: [], error: null });

    await expect(
      requireWallTrailTileOrSkip(true, client),
    ).resolves.toBeUndefined();
    expect(skip).toHaveBeenCalledWith(true, expect.stringContaining("heroImage"));
    expect(calls()).toBe(0);
  });

  it("skips when the wall composes fewer products than the trail cadence", async () => {
    trailFrontmatter.mockReturnValue(withHeroImage);
    const { client } = supabaseReturning({
      data: rowsPerBrand(...Array(TRAIL_SLOT_CADENCE - 1).fill(1)),
      error: null,
    });

    await expect(
      requireWallTrailTileOrSkip(true, client),
    ).resolves.toBeUndefined();
    expect(skip).toHaveBeenCalledWith(
      true,
      expect.stringContaining(`${TRAIL_SLOT_CADENCE - 1} products`),
    );
  });

  it("counts products AFTER the per-brand cap, not before", async () => {
    // The false red this guard could easily have shipped: twenty eligible rows
    // look like plenty, but three brands capped at two compose a wall of six —
    // below the cadence, so no trail slot is reserved and an absent tile is
    // correct. Gating on the raw row count would call that a regression.
    trailFrontmatter.mockReturnValue(withHeroImage);
    const { client } = supabaseReturning({
      data: rowsPerBrand(7, 7, 6),
      error: null,
    });

    await expect(
      requireWallTrailTileOrSkip(true, client),
    ).resolves.toBeUndefined();
    expect(skip).toHaveBeenCalledWith(
      true,
      expect.stringContaining(
        `${3 * MAX_HOME_CURATED_PRODUCTS_PER_BRAND} products`,
      ),
    );
  });

  it("throws when both gates are open and the tile is missing", async () => {
    trailFrontmatter.mockReturnValue(withHeroImage);
    const { client } = supabaseReturning({
      data: rowsPerBrand(...Array(TRAIL_SLOT_CADENCE).fill(1)),
      error: null,
    });

    await expect(requireWallTrailTileOrSkip(true, client)).rejects.toThrow(
      /no discovery trail tile/,
    );
    expect(skip).not.toHaveBeenCalled();
  });

  it("never composes more than the wall's product cap", async () => {
    trailFrontmatter.mockReturnValue(withHeroImage);
    const { client } = supabaseReturning({
      data: rowsPerBrand(...Array(40).fill(2)),
      error: null,
    });

    await expect(requireWallTrailTileOrSkip(true, client)).rejects.toThrow(
      new RegExp(`composes ${MAX_HOME_WALL_PRODUCTS} products`),
    );
  });

  it("skips rather than inventing a red when the row read fails", async () => {
    trailFrontmatter.mockReturnValue(withHeroImage);
    const { client } = supabaseReturning(new Error("network down"));

    await expect(
      requireWallTrailTileOrSkip(true, client),
    ).resolves.toBeUndefined();
    expect(skip).toHaveBeenCalledWith(
      true,
      expect.stringContaining("could not be counted"),
    );
  });

  it("keeps its own cache, so a failure evicts only its own probe", async () => {
    trailFrontmatter.mockReturnValue(withHeroImage);
    const { client, calls } = supabaseReturning(new Error("timeout"), {
      data: rowsPerBrand(...Array(TRAIL_SLOT_CADENCE).fill(1)),
      error: null,
    });

    await expect(
      requireWallTrailTileOrSkip(true, client),
    ).resolves.toBeUndefined();
    await expect(requireWallTrailTileOrSkip(true, client)).rejects.toThrow(
      /no discovery trail tile/,
    );
    expect(calls()).toBe(2);
  });
});
