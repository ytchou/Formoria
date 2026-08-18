import { beforeEach, describe, expect, it, vi } from "vitest";

const skip = vi.fn();
vi.mock("@playwright/test", () => ({ test: { skip: (...args: unknown[]) => skip(...args) } }));

import {
  MIN_HOME_CURATED_PRODUCTS,
  requireWallOrSkip,
  resetWallSupplyProbe,
  type WallSupplySupabase,
} from "../wall-supply";
import { TEST_BRAND_NAME_PATTERN } from "../../../src/lib/services/public-brand-filter";

type CountResult = { count: number | null; error: unknown };

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
  for (const method of ["eq", "not"]) {
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
