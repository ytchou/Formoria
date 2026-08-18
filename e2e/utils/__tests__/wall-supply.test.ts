import { beforeEach, describe, expect, it, vi } from "vitest";

const skip = vi.fn();
vi.mock("@playwright/test", () => ({ test: { skip: (...args: unknown[]) => skip(...args) } }));

import {
  MIN_HOME_CURATED_PRODUCTS,
  requireWallOrSkip,
  resetWallSupplyProbe,
  type WallSupplySupabase,
} from "../wall-supply";

/**
 * Minimal PostgREST double: every builder method chains, and awaiting the
 * builder resolves the count response the test asked for. `curated_products`
 * is the only table the guard reads.
 */
function supabaseReturning(
  result: { count: number | null; error: unknown } | Error,
): { client: WallSupplySupabase; calls: () => number } {
  let calls = 0;
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "not"]) {
    builder[method] = () => builder;
  }
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => (result instanceof Error
    ? Promise.reject(result).then(resolve, reject)
    : Promise.resolve(result).then(resolve, reject));

  const client = {
    from: (table: string) => {
      calls += 1;
      expect(table).toBe("curated_products");
      return builder;
    },
  } as unknown as WallSupplySupabase;

  return { client, calls: () => calls };
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
});
