import { describe, expect, it, vi } from "vitest";

import { rerankWithCohere, type RerankCandidate } from "../cohere-rerank-audit";
import type { CohereRerankResult } from "../cohere-rerank-client";
import type { RerankCache } from "@/lib/cache/rerank-cache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidates(count: number): RerankCandidate[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `id-${i}`,
    document: `Product ${i} description`,
  }));
}

function makeRpcScores(ids: string[]) {
  return ids.map((id, i) => ({
    productId: id,
    rankScore: 1 - i * 0.1,
    cosineSim: 0.9 - i * 0.05,
    lexicalScore: 0.5 + i * 0.02,
  }));
}

function makeMeta(candidates: RerankCandidate[]) {
  return {
    rpcScores: makeRpcScores(candidates.map((c) => c.id)),
    category: "lifestyle" as string | null,
  };
}

function makeCohereResult(
  indices: number[],
  scores: number[],
): CohereRerankResult {
  return {
    results: indices.map((index, i) => ({
      index,
      relevanceScore: scores[i]!,
    })),
  };
}

function makeCache(
  overrides: Partial<RerankCache> = {},
): RerankCache {
  return {
    get: vi.fn<RerankCache["get"]>().mockResolvedValue(null),
    set: vi.fn<RerankCache["set"]>().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeClient(
  result?: CohereRerankResult,
) {
  return {
    rerank: vi
      .fn()
      .mockResolvedValue(
        result ?? makeCohereResult([2, 0, 1], [0.95, 0.8, 0.6]),
      ),
  };
}

function makeAudit() {
  const auditMock = vi.fn(
    async (
      _spec: unknown,
      fn: (ctx: { summary: Record<string, unknown>; costUsd?: number | null }) => unknown,
      opts?: { summary?: Record<string, unknown> },
    ) => {
      const ctx = { summary: {}, ...opts };
      return fn(ctx);
    },
  );
  return auditMock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("rerankWithCohere", () => {
  it("calls cohere and returns reordered candidates", async () => {
    const candidates = makeCandidates(3);
    // Cohere returns indices [2, 0, 1] — reordering to id-2, id-0, id-1
    const client = makeClient(
      makeCohereResult([2, 0, 1], [0.95, 0.8, 0.6]),
    );
    const cache = makeCache();
    const audit = makeAudit();

    const result = await rerankWithCohere(
      "tea gift",
      candidates,
      makeMeta(candidates),
      { client, cache, audit },
    );

    expect(client.rerank).toHaveBeenCalledWith(
      "tea gift",
      candidates.map((c) => c.document),
      candidates.length,
    );
    expect(result).toEqual([
      { id: "id-2", document: "Product 2 description" },
      { id: "id-0", document: "Product 0 description" },
      { id: "id-1", document: "Product 1 description" },
    ]);
  });

  it("writes audit with correct summary fields", async () => {
    const candidates = makeCandidates(3);
    const cohereResult = makeCohereResult([1, 2, 0], [0.9, 0.7, 0.3]);
    const client = makeClient(cohereResult);
    const cache = makeCache();
    const audit = vi.fn(
      async (
        _spec: unknown,
        fn: (ctx: { summary: Record<string, unknown>; costUsd?: number | null }) => unknown,
        opts?: { summary?: Record<string, unknown> },
      ) => {
        const ctx: { summary: Record<string, unknown>; costUsd?: number | null } = {
          summary: {},
          ...opts,
        };
        const result = await fn(ctx);
        expect(ctx.summary).toEqual(
          expect.objectContaining({
            scoreSpread: expect.any(Number),
            topScoreRatio: expect.any(Number),
            inputScores: expect.any(Array),
            cohereScores: expect.any(Array),
            rerankDelta: expect.any(Number),
            cacheHit: false,
            candidateCount: 3,
          }),
        );
        expect(ctx.summary.cohereScores).toEqual([0.9, 0.7, 0.3]);
        expect(ctx.summary.scoreSpread).toBeCloseTo(0.6);
        expect(ctx.summary.topScoreRatio).toBeCloseTo(0.9 / 0.7);
        expect(ctx.costUsd).toBe(0.002);
        return result;
      },
    );

    await rerankWithCohere(
      "tea gift",
      candidates,
      makeMeta(candidates),
      { client, cache, audit },
    );

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "cohere",
        operation: "rerank",
        kind: "external",
      }),
      expect.any(Function),
      expect.objectContaining({ summary: {} }),
    );
  });

  it("returns original order on error (fail-open)", async () => {
    const candidates = makeCandidates(3);
    const client = {
      rerank: vi.fn().mockRejectedValue(new Error("Cohere 503")),
    };
    const cache = makeCache();
    const audit = makeAudit();

    const result = await rerankWithCohere(
      "tea gift",
      candidates,
      makeMeta(candidates),
      { client, cache, audit },
    );

    // Original order preserved
    expect(result.map((c) => c.id)).toEqual(["id-0", "id-1", "id-2"]);
    // Result is a copy, not the original reference
    expect(result).not.toBe(candidates);
  });

  it("uses cache hit and skips cohere call", async () => {
    const candidates = makeCandidates(3);
    const cache = makeCache({
      get: vi.fn<RerankCache["get"]>().mockResolvedValue(["id-2", "id-0", "id-1"]),
    });
    const client = makeClient();
    const audit = makeAudit();

    const result = await rerankWithCohere(
      "tea gift",
      candidates,
      makeMeta(candidates),
      { client, cache, audit },
    );

    expect(cache.get).toHaveBeenCalledWith("tea gift", "cohere:lifestyle");
    expect(client.rerank).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(result.map((c) => c.id)).toEqual(["id-2", "id-0", "id-1"]);
  });

  it("cache hit appends uncached candidates to maintain pool size", async () => {
    const candidates = makeCandidates(4);
    // Cache only knows about id-2 and id-0 — id-1 and id-3 are missing
    const cache = makeCache({
      get: vi.fn<RerankCache["get"]>().mockResolvedValue(["id-2", "id-0"]),
    });
    const client = makeClient();
    const audit = makeAudit();

    const result = await rerankWithCohere(
      "tea gift",
      candidates,
      makeMeta(candidates),
      { client, cache, audit },
    );

    // Cached order first, then uncached in original order
    expect(result.map((c) => c.id)).toEqual(["id-2", "id-0", "id-1", "id-3"]);
    expect(client.rerank).not.toHaveBeenCalled();
  });

  it("writes cache on miss", async () => {
    const candidates = makeCandidates(3);
    const cohereResult = makeCohereResult([2, 0, 1], [0.95, 0.8, 0.6]);
    const client = makeClient(cohereResult);
    const cache = makeCache();
    const audit = makeAudit();

    await rerankWithCohere(
      "tea gift",
      candidates,
      makeMeta(candidates),
      { client, cache, audit },
    );

    expect(cache.get).toHaveBeenCalledWith("tea gift", "cohere:lifestyle");
    expect(cache.set).toHaveBeenCalledWith(
      "tea gift",
      "cohere:lifestyle",
      ["id-2", "id-0", "id-1"],
    );
  });

  it("rerankDelta counts position changes in top-5", async () => {
    // 5 candidates, Cohere reverses the order completely
    const candidates = makeCandidates(5);
    const cohereResult = makeCohereResult(
      [4, 3, 2, 1, 0],
      [0.99, 0.9, 0.8, 0.7, 0.6],
    );
    const client = makeClient(cohereResult);
    const cache = makeCache();
    let capturedDelta: number | undefined;
    const audit = vi.fn(
      async (
        _spec: unknown,
        fn: (ctx: { summary: Record<string, unknown>; costUsd?: number | null }) => unknown,
        opts?: { summary?: Record<string, unknown> },
      ) => {
        const ctx: { summary: Record<string, unknown>; costUsd?: number | null } = {
          summary: {},
          ...opts,
        };
        const result = await fn(ctx);
        capturedDelta = ctx.summary.rerankDelta as number;
        return result;
      },
    );

    await rerankWithCohere(
      "tea gift",
      candidates,
      makeMeta(candidates),
      { client, cache, audit },
    );

    // Input order: [id-0, id-1, id-2, id-3, id-4]
    // Output order: [id-4, id-3, id-2, id-1, id-0]
    // 4 of 5 positions changed (center element id-2 stays at index 2)
    expect(capturedDelta).toBe(4);
  });
});
