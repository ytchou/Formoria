import { describe, expect, it } from "vitest";
import type { ProductCandidate } from "../../enrich-phases/product-candidates";
import {
  applyGates,
  rankAndSelect,
  persistCandidatePool,
  type CandidateRow,
  type CandidateWriter,
  type LlmRanker,
} from "../candidate-selection";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function candidate(
  overrides: Partial<ProductCandidate> = {},
): ProductCandidate {
  return {
    url: "https://brand.example/products/clay-plate",
    normalizedUrl: "https://brand.example/products/clay-plate",
    title: "Clay Plate",
    imageUrl: "https://brand.example/img/plate.jpg",
    supplier: "stored",
    urlClass: "product-detail",
    searchPosition: 1,
    ...overrides,
  };
}

type TestWriter = CandidateWriter & { written: CandidateRow[] };

function noopWriter(): TestWriter {
  const rows: CandidateRow[] = [];
  return {
    insert: async (r: CandidateRow[]) => {
      rows.push(...r);
      return { data: r, error: null };
    },
    written: rows,
  };
}

function failingWriter(): CandidateWriter {
  return {
    insert: async () => ({ data: null, error: { message: "DB write failed" } }),
  };
}

function fixedRanker(scores: Record<string, number>): LlmRanker {
  return async (candidates) => {
    return candidates.map((c) => ({
      url: c.url,
      score: scores[c.url] ?? 5,
      rationale: `Ranked ${c.url}`,
    }));
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("candidate-selection", () => {
  it("gate_drops_imageless_candidate", () => {
    const pool = [
      candidate({ imageUrl: undefined }),
      candidate({
        url: "https://brand.example/products/tea-cup",
        normalizedUrl: "https://brand.example/products/tea-cup",
        imageUrl: "https://brand.example/img/cup.jpg",
      }),
    ];

    const { gated, passed } = applyGates(pool, []);

    // The imageless candidate is gated out with 'no_image'.
    expect(gated).toHaveLength(1);
    expect(gated[0]!.gateResult).toBe("no_image");
    expect(gated[0]!.candidate.url).toBe(
      "https://brand.example/products/clay-plate",
    );
    // The candidate with an image passes.
    expect(passed).toHaveLength(1);
    expect(passed[0]!.url).toBe("https://brand.example/products/tea-cup");
  });

  it("gate_drops_listing_class_candidate", () => {
    const pool = [
      candidate({ urlClass: "listing", url: "https://brand.example/shop" }),
      candidate(),
    ];

    const { gated, passed } = applyGates(pool, []);

    expect(gated).toHaveLength(1);
    expect(gated[0]!.gateResult).toBe("not_product_detail");
    expect(passed).toHaveLength(1);
  });

  it("variety_constraint_blocks_near_duplicate_of_accepted", () => {
    // Two candidates with the same normalizedUrl: the first one is in the
    // already-accepted set, so the second is gated as 'near_duplicate'.
    const accepted = [
      candidate({
        url: "https://brand.example/products/clay-plate?variant=red",
        normalizedUrl: "https://brand.example/products/clay-plate",
      }),
    ];
    const pool = [
      candidate({
        url: "https://brand.example/products/clay-plate?variant=blue",
        normalizedUrl: "https://brand.example/products/clay-plate",
        imageUrl: "https://brand.example/img/plate-blue.jpg",
      }),
      candidate({
        url: "https://brand.example/products/tea-cup",
        normalizedUrl: "https://brand.example/products/tea-cup",
        imageUrl: "https://brand.example/img/cup.jpg",
      }),
    ];

    const { gated, passed } = applyGates(pool, accepted);

    expect(gated).toHaveLength(1);
    expect(gated[0]!.gateResult).toBe("near_duplicate");
    expect(passed).toHaveLength(1);
    expect(passed[0]!.url).toBe("https://brand.example/products/tea-cup");
  });

  it("position_breaks_ties_only", async () => {
    const c1 = candidate({
      url: "https://brand.example/products/a",
      normalizedUrl: "https://brand.example/products/a",
      imageUrl: "https://brand.example/img/a.jpg",
      searchPosition: 10,
    });
    const c2 = candidate({
      url: "https://brand.example/products/b",
      normalizedUrl: "https://brand.example/products/b",
      imageUrl: "https://brand.example/img/b.jpg",
      searchPosition: 1,
    });
    const c3 = candidate({
      url: "https://brand.example/products/c",
      normalizedUrl: "https://brand.example/products/c",
      imageUrl: "https://brand.example/img/c.jpg",
      searchPosition: 5,
    });

    // c1 has the highest LLM score (9), c2 and c3 are tied (7).
    // Despite c2 having the lowest search position, it must NOT override
    // c1's higher LLM score.
    const ranker = fixedRanker({
      "https://brand.example/products/a": 9,
      "https://brand.example/products/b": 7,
      "https://brand.example/products/c": 7,
    });

    const result = await rankAndSelect([c1, c2, c3], ranker, 5);

    // c1 is first (highest LLM score).
    expect(result[0]!.url).toBe("https://brand.example/products/a");
    // Among the tied pair, c2 (position 1) beats c3 (position 5).
    expect(result[1]!.url).toBe("https://brand.example/products/b");
    expect(result[2]!.url).toBe("https://brand.example/products/c");

    // Verify ranks are assigned.
    expect(result[0]!.finalRank).toBe(1);
    expect(result[1]!.finalRank).toBe(2);
    expect(result[2]!.finalRank).toBe(3);
  });

  it("every_candidate_is_persisted_with_gate_result", async () => {
    const pool = [
      candidate({ imageUrl: undefined }), // gated: no_image
      candidate({
        url: "https://brand.example/shop",
        normalizedUrl: "https://brand.example/shop",
        urlClass: "listing",
      }), // gated: not_product_detail
      candidate({
        url: "https://brand.example/products/tea-cup",
        normalizedUrl: "https://brand.example/products/tea-cup",
        imageUrl: "https://brand.example/img/cup.jpg",
      }), // passes
    ];

    const writer = noopWriter();
    const ranker = fixedRanker({
      "https://brand.example/products/tea-cup": 8,
    });

    await persistCandidatePool({
      pool,
      acceptedCandidates: [],
      ranker,
      writer,
      brandId: "brand-uuid",
      submissionId: "sub-uuid",
      jobId: "job-uuid",
      maxProducts: 5,
    });

    // All N=3 candidates are persisted — including gated ones.
    expect(writer.written).toHaveLength(3);

    // Gated candidates carry their gate_result.
    const gatedRows = writer.written.filter(
      (r) => r.gate_result !== "passed",
    );
    expect(gatedRows).toHaveLength(2);
    expect(gatedRows.map((r) => r.gate_result).sort()).toEqual([
      "no_image",
      "not_product_detail",
    ]);
    // Gated candidates have no LLM score or rank.
    for (const row of gatedRows) {
      expect(row.llm_score).toBeNull();
      expect(row.final_rank).toBeNull();
    }

    // The passing candidate has LLM score, rationale and rank.
    const passedRow = writer.written.find(
      (r) => r.gate_result === "passed",
    )!;
    expect(passedRow.llm_score).toBe(8);
    expect(passedRow.llm_rationale).toBe(
      "Ranked https://brand.example/products/tea-cup",
    );
    expect(passedRow.final_rank).toBe(1);
  });

  it("persistence_failure_does_not_fail_the_phase", async () => {
    const pool = [
      candidate({
        url: "https://brand.example/products/tea-cup",
        normalizedUrl: "https://brand.example/products/tea-cup",
        imageUrl: "https://brand.example/img/cup.jpg",
      }),
    ];

    const writer = failingWriter();
    const ranker = fixedRanker({
      "https://brand.example/products/tea-cup": 8,
    });

    const result = await persistCandidatePool({
      pool,
      acceptedCandidates: [],
      ranker,
      writer,
      brandId: "brand-uuid",
      submissionId: "sub-uuid",
      maxProducts: 5,
    });

    // Proposals still return despite the write error.
    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0]!.url).toBe(
      "https://brand.example/products/tea-cup",
    );
    // The error is reported but not thrown.
    expect(result.persistError).toBe("DB write failed");
  });
});
