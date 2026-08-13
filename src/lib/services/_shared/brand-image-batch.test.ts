import { describe, expect, it } from "vitest";
import {
  BRAND_IMAGE_READ_CONCURRENCY,
  fetchActiveBrandImageRows,
  type BrandImageBatch,
  type BrandImageQueryClient,
} from "./brand-image-batch";

/**
 * A client that records how many reads are in flight at once.
 *
 * Each `range()` resolves on a later microtask, so every request started before
 * the first one settles overlaps — which is what makes the peak meaningful.
 */
function trackingClient(): {
  client: BrandImageQueryClient;
  peakInFlight: () => number;
  calls: () => number;
} {
  let inFlight = 0;
  let peak = 0;
  let calls = 0;

  const chain = {
    in: () => chain,
    eq: () => chain,
    order: () => chain,
    range: async () => {
      calls += 1;
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Yield repeatedly so concurrent callers interleave before any settles.
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
      inFlight -= 1;
      return { data: [], error: null };
    },
  };

  return {
    client: {
      from: () => ({ select: () => chain }),
    } as unknown as BrandImageQueryClient,
    peakInFlight: () => peak,
    calls: () => calls,
  };
}

function batches(count: number): BrandImageBatch[] {
  return Array.from({ length: count }, (_, index) => ({
    brandIds: [`brand-${index}`],
  }));
}

describe("fetchActiveBrandImageRows", () => {
  it("bounds concurrent reads regardless of batch count", async () => {
    const { client, peakInFlight } = trackingClient();

    await fetchActiveBrandImageRows(client, "id", batches(40));

    expect(peakInFlight()).toBeLessThanOrEqual(BRAND_IMAGE_READ_CONCURRENCY);
  });

  it("still issues one read per batch", async () => {
    const { client, calls } = trackingClient();

    await fetchActiveBrandImageRows(client, "id", batches(12));

    expect(calls()).toBe(12);
  });

  it("does not throttle below the batch count when batches are few", async () => {
    const { client, peakInFlight } = trackingClient();

    await fetchActiveBrandImageRows(client, "id", batches(2));

    expect(peakInFlight()).toBe(2);
  });

  it("returns rows from every batch in batch order", async () => {
    let batchIndex = 0;
    const chain = {
      in: () => chain,
      eq: () => chain,
      order: () => chain,
      range: async () => {
        const current = batchIndex;
        batchIndex += 1;
        await Promise.resolve();
        return { data: [{ id: `row-${current}` }], error: null };
      },
    };
    const client = {
      from: () => ({ select: () => chain }),
    } as unknown as BrandImageQueryClient;

    const rows = await fetchActiveBrandImageRows<{ id: string }>(
      client,
      "id",
      batches(3),
    );

    expect(rows.map((row) => row.id)).toEqual(["row-0", "row-1", "row-2"]);
  });
});
