import { describe, expect, it, vi } from "vitest";
import {
  MAX_BULK_CORRECTIONS,
  reviewCorrections,
  validateCorrectionBatch,
  type CorrectionDecision,
  type ReviewCorrectionResult,
  type ReviewCorrectionsDeps,
} from "@/lib/services/brand-corrections";

// The batch function is exercised through its injected `deps` seam rather than
// module mocks: `scripts/check-test-boundaries.mjs` hard-fails on any vi.mock of
// `@/lib/services/`, `@/lib/supabase/` or `@supabase/`, so the seam IS the test
// strategy (same shape as `enrichReporterRows` in `reports.ts`).

const REVIEWER_ID = "9c1f4b2e-6d38-4a71-8c05-2f7b9e1d4a63";
const BRAND_KILN = "3f0a9d21-77c4-4e58-9b12-0d6e5c8a4471";
const BRAND_LOOM = "b58c2e14-90af-4d63-a7f1-52c9d0e37b88";
const CORRECTION_ONE = "11e4c6a0-2b95-4d17-8f3a-6c07b912de45";
const CORRECTION_TWO = "22a7f3d9-4c81-4be2-9d06-7e15a840cb32";
const CORRECTION_THREE = "33b8e5c2-1f60-4a93-b48d-9c02f6e71da5";
const CORRECTION_UNSELECTED = "44d1a7b6-3e29-4c05-8a71-b6f3c9e2408d";

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PendingRow = { id: string; brand_id: string };

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Deterministic ordering probe. Every assertion in this file is about WHICH
 * calls have happened, never about how long they took — a sleep-based test of
 * serialization is flaky under load and would pass against a flat Promise.all
 * on a fast machine.
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function fetcher(rows: PendingRow[]): ReviewCorrectionsDeps["fetchPendingBrandIds"] {
  return async () => rows;
}

const APPROVED: CorrectionDecision = "approved";

describe("reviewCorrections", () => {
  it("serializes corrections targeting the same brand", async () => {
    const gates = new Map([
      [CORRECTION_ONE, deferred<ReviewCorrectionResult>()],
      [CORRECTION_TWO, deferred<ReviewCorrectionResult>()],
    ]);
    const started: string[] = [];
    const reviewOne = vi.fn(async (id: string) => {
      started.push(id);
      return gates.get(id)!.promise;
    });

    const pending = reviewCorrections(
      [CORRECTION_ONE, CORRECTION_TWO],
      APPROVED,
      "",
      { reviewerId: REVIEWER_ID },
      {
        fetchPendingBrandIds: fetcher([
          { id: CORRECTION_ONE, brand_id: BRAND_KILN },
          { id: CORRECTION_TWO, brand_id: BRAND_KILN },
        ]),
        reviewOne,
      },
    );

    await flush();
    // Second item must not have begun while the first is still in flight:
    // two concurrent updateBrand writes on one brand lose one silently.
    expect(started).toEqual([CORRECTION_ONE]);

    gates.get(CORRECTION_ONE)!.resolve({ ok: true });
    await flush();
    expect(started).toEqual([CORRECTION_ONE, CORRECTION_TWO]);

    gates.get(CORRECTION_TWO)!.resolve({ ok: true });
    await expect(pending).resolves.toEqual({ failures: [] });
  });

  it("runs corrections for different brands concurrently", async () => {
    const gates = new Map([
      [CORRECTION_ONE, deferred<ReviewCorrectionResult>()],
      [CORRECTION_TWO, deferred<ReviewCorrectionResult>()],
    ]);
    const started: string[] = [];
    const reviewOne = vi.fn(async (id: string) => {
      started.push(id);
      return gates.get(id)!.promise;
    });

    const pending = reviewCorrections(
      [CORRECTION_ONE, CORRECTION_TWO],
      APPROVED,
      "",
      { reviewerId: REVIEWER_ID },
      {
        fetchPendingBrandIds: fetcher([
          { id: CORRECTION_ONE, brand_id: BRAND_KILN },
          { id: CORRECTION_TWO, brand_id: BRAND_LOOM },
        ]),
        reviewOne,
      },
    );

    await flush();
    expect(started).toEqual([CORRECTION_ONE, CORRECTION_TWO]);

    gates.get(CORRECTION_ONE)!.resolve({ ok: true });
    gates.get(CORRECTION_TWO)!.resolve({ ok: true });
    await expect(pending).resolves.toEqual({ failures: [] });
  });

  it("reports a failed lookup per item instead of aborting the batch", async () => {
    const reviewOne = vi.fn(
      async (): Promise<ReviewCorrectionResult> => ({ ok: true }),
    );
    const fetchPendingBrandIds = vi.fn(async (): Promise<PendingRow[]> => {
      throw new Error("connection reset");
    });

    const result = await reviewCorrections(
      [CORRECTION_ONE, CORRECTION_TWO],
      APPROVED,
      "",
      { reviewerId: REVIEWER_ID },
      { fetchPendingBrandIds, reviewOne },
    );

    // Every selected id gets its own outcome — never one batch-level error.
    expect(result).toEqual({
      failures: [
        { id: CORRECTION_ONE, code: "database_error" },
        { id: CORRECTION_TWO, code: "database_error" },
      ],
    });
    expect(reviewOne).not.toHaveBeenCalled();
  });

  it("leaves unselected ids untouched", async () => {
    const reviewed: string[] = [];
    const reviewOne = vi.fn(
      async (id: string): Promise<ReviewCorrectionResult> => {
        reviewed.push(id);
        return { ok: true };
      },
    );
    const fetchPendingBrandIds = vi.fn(async (): Promise<PendingRow[]> => [
      { id: CORRECTION_ONE, brand_id: BRAND_KILN },
      { id: CORRECTION_UNSELECTED, brand_id: BRAND_KILN },
    ]);

    const result = await reviewCorrections(
      [CORRECTION_ONE],
      APPROVED,
      "",
      { reviewerId: REVIEWER_ID },
      { fetchPendingBrandIds, reviewOne },
    );

    expect(fetchPendingBrandIds).toHaveBeenCalledWith([CORRECTION_ONE]);
    expect(reviewed).toEqual([CORRECTION_ONE]);
    expect(reviewed).not.toContain(CORRECTION_UNSELECTED);
    expect(result).toEqual({ failures: [] });
  });

  it("returns per-item failures keyed by id", async () => {
    const reviewOne = vi.fn(async (id: string): Promise<ReviewCorrectionResult> => {
      if (id === CORRECTION_TWO) return { ok: false, code: "database_error" };
      if (id === CORRECTION_THREE) throw new Error("connection reset");
      return { ok: true };
    });

    const result = await reviewCorrections(
      [CORRECTION_ONE, CORRECTION_TWO, CORRECTION_THREE],
      APPROVED,
      "",
      { reviewerId: REVIEWER_ID },
      {
        fetchPendingBrandIds: fetcher([
          { id: CORRECTION_ONE, brand_id: BRAND_KILN },
          { id: CORRECTION_TWO, brand_id: BRAND_LOOM },
          { id: CORRECTION_THREE, brand_id: BRAND_LOOM },
        ]),
        reviewOne,
      },
    );

    // A failure aborts neither its own group's remaining items nor the others.
    expect(reviewOne).toHaveBeenCalledTimes(3);
    expect("failures" in result && result.failures).toEqual(
      expect.arrayContaining([
        { id: CORRECTION_TWO, code: "database_error" },
        { id: CORRECTION_THREE, code: "database_error" },
      ]),
    );
    expect("failures" in result && result.failures).toHaveLength(2);
  });

  it("reports ids with no pending row as not_found", async () => {
    const reviewOne = vi.fn(async (): Promise<ReviewCorrectionResult> => ({
      ok: true,
    }));

    const result = await reviewCorrections(
      [CORRECTION_ONE, CORRECTION_TWO],
      APPROVED,
      "",
      { reviewerId: REVIEWER_ID },
      {
        fetchPendingBrandIds: fetcher([
          { id: CORRECTION_ONE, brand_id: BRAND_KILN },
        ]),
        reviewOne,
      },
    );

    expect(reviewOne).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      failures: [{ id: CORRECTION_TWO, code: "not_found" }],
    });
  });

  it("rejects a batch over the maximum size", async () => {
    const reviewOne = vi.fn(async (): Promise<ReviewCorrectionResult> => ({
      ok: true,
    }));
    const fetchPendingBrandIds = vi.fn(async (): Promise<PendingRow[]> => []);
    const ids = Array.from(
      { length: MAX_BULK_CORRECTIONS + 1 },
      (_, index) => `${CORRECTION_ONE}-${index}`,
    );

    const result = await reviewCorrections(
      ids,
      APPROVED,
      "",
      { reviewerId: REVIEWER_ID },
      { fetchPendingBrandIds, reviewOne },
    );

    // An error result, not a partial run: nothing is fetched and nothing is
    // reviewed.
    expect(result).toEqual({ error: "Invalid bulk correction selection" });
    expect(fetchPendingBrandIds).not.toHaveBeenCalled();
    expect(reviewOne).not.toHaveBeenCalled();
  });

  it("skips items already decided", async () => {
    const reviewOne = vi.fn(async (id: string): Promise<ReviewCorrectionResult> =>
      id === CORRECTION_ONE
        ? { ok: false, code: "already_reviewed" }
        : { ok: true },
    );

    const result = await reviewCorrections(
      [CORRECTION_ONE, CORRECTION_TWO],
      APPROVED,
      "",
      { reviewerId: REVIEWER_ID },
      {
        fetchPendingBrandIds: fetcher([
          { id: CORRECTION_ONE, brand_id: BRAND_KILN },
          { id: CORRECTION_TWO, brand_id: BRAND_LOOM },
        ]),
        reviewOne,
      },
    );

    // Reported as a conflict, and attempted exactly once — never re-applied.
    expect(
      reviewOne.mock.calls.filter(([id]) => id === CORRECTION_ONE),
    ).toHaveLength(1);
    expect(result).toEqual({
      failures: [{ id: CORRECTION_ONE, code: "already_reviewed" }],
    });
  });

  it("decides the valid ids when the selection carries a non-uuid id", async () => {
    const reviewOne = vi.fn<ReviewCorrectionsDeps["reviewOne"]>(async () => ({
      ok: true,
    }));
    // `.in('id', ids)` casts every element to uuid, so a malformed id used to
    // fail the whole lookup with Postgres 22P02 and strand the valid items.
    const fetchPendingBrandIds = vi.fn(async (ids: string[]) => {
      if (ids.some((id) => !UUID_SHAPE.test(id))) {
        throw new Error('invalid input syntax for type uuid: "not-a-uuid"');
      }
      return [
        { id: CORRECTION_ONE, brand_id: BRAND_KILN },
        { id: CORRECTION_TWO, brand_id: BRAND_LOOM },
      ];
    });

    const result = await reviewCorrections(
      [CORRECTION_ONE, "not-a-uuid", CORRECTION_TWO],
      APPROVED,
      "",
      { reviewerId: REVIEWER_ID },
      { fetchPendingBrandIds, reviewOne },
    );

    expect(fetchPendingBrandIds).toHaveBeenCalledWith([
      CORRECTION_ONE,
      CORRECTION_TWO,
    ]);
    expect(reviewOne.mock.calls.map(([id]) => id).sort()).toEqual(
      [CORRECTION_ONE, CORRECTION_TWO].sort(),
    );
    // Every selected id still gets an individual outcome.
    expect(result).toEqual({
      failures: [{ id: "not-a-uuid", code: "invalid_id" }],
    });
  });
});

describe("validateCorrectionBatch", () => {
  it("dedupes ids and preserves input order", () => {
    expect(
      validateCorrectionBatch([CORRECTION_TWO, CORRECTION_ONE, CORRECTION_TWO]),
    ).toEqual({ ok: true, ids: [CORRECTION_TWO, CORRECTION_ONE] });
  });

  it("rejects an empty selection", () => {
    expect(validateCorrectionBatch([])).toEqual({
      ok: false,
      error: "Invalid bulk correction selection",
    });
  });

  it("rejects malformed ids", () => {
    expect(validateCorrectionBatch([""])).toEqual({
      ok: false,
      error: "Invalid bulk correction selection",
    });
    expect(validateCorrectionBatch(["x".repeat(65)])).toEqual({
      ok: false,
      error: "Invalid bulk correction selection",
    });
  });
});
