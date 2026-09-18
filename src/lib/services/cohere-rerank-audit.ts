import { auditedCall, type AuditCallContext } from "@/lib/audit";
import { normalizeSituationQuery } from "@/lib/services/product-situation-search";
import type { CohereRerankResult } from "./cohere-rerank-client";
import { createCohereRerankClient } from "./cohere-rerank-client";
import type { RerankCache } from "@/lib/cache/rerank-cache";
import { getDefaultRerankCache } from "@/lib/cache/rerank-cache";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RerankCandidate = {
  id: string;
  document: string;
};

type RpcScoreEntry = {
  productId: string;
  rankScore: number;
  cosineSim: number;
  lexicalScore: number;
};

type RerankMeta = {
  rpcScores: RpcScoreEntry[];
  category: string | null;
};

type AuditFn = (
  spec: { provider: string; operation: string; kind: "external" | "service" },
  fn: (ctx: AuditCallContext) => unknown | Promise<unknown>,
  options?: { summary?: Record<string, unknown> },
) => Promise<unknown>;

type RerankDeps = {
  client: ReturnType<typeof createCohereRerankClient>;
  cache: RerankCache;
  audit?: AuditFn;
};

// ---------------------------------------------------------------------------
// Score helpers
// ---------------------------------------------------------------------------

function computeRerankDelta(
  inputIds: string[],
  outputIds: string[],
  k: number = 5,
): number {
  const topInput = inputIds.slice(0, k);
  const topOutput = outputIds.slice(0, k);
  let delta = 0;
  for (let i = 0; i < k; i++) {
    if (topInput[i] !== topOutput[i]) delta++;
  }
  return delta;
}

function computeScoreSpread(scores: number[]): number {
  if (scores.length < 2) return 0;
  return Math.max(...scores) - Math.min(...scores);
}

function computeTopScoreRatio(scores: number[]): number {
  if (scores.length < 2) return 0;
  if (scores[1] === 0) return scores[0] === 0 ? 1 : Infinity;
  return scores[0]! / scores[1]!;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function rerankWithCohere(
  query: string,
  candidates: RerankCandidate[],
  meta: RerankMeta,
  deps?: Partial<RerankDeps>,
): Promise<RerankCandidate[]> {
  if (candidates.length === 0) return [];

  const resolved: RerankDeps = {
    client: deps?.client ?? createCohereRerankClient(),
    cache: deps?.cache ?? getDefaultRerankCache(),
    audit: deps?.audit ?? auditedCall,
  };

  const cacheReranker = `cohere:${meta.category ?? "all"}`;

  try {
    const normalized = normalizeSituationQuery(query);

    // Check cache
    const cachedIds = await resolved.cache.get(normalized, cacheReranker);
    if (cachedIds) {
      const byId = new Map(candidates.map((c) => [c.id, c]));
      const cached = cachedIds
        .map((id) => byId.get(id))
        .filter((c): c is RerankCandidate => c !== undefined);
      // Append candidates missing from cache to maintain pool size
      if (cached.length < candidates.length) {
        const seen = new Set(cached.map((c) => c.id));
        for (const c of candidates) {
          if (!seen.has(c.id)) cached.push(c);
        }
      }
      console.info("[cohere-rerank] cache hit", {
        query: normalized.slice(0, 50),
        category: meta.category,
      });
      return cached;
    }

    const inputIds = candidates.map((c) => c.id);
    const inputScores = meta.rpcScores.map((s) => ({
      productId: s.productId,
      rankScore: s.rankScore,
    }));

    const result = (await resolved.audit!(
      {
        provider: "cohere",
        operation: "rerank",
        kind: "external",
      },
      async (ctx: AuditCallContext) => {
        const cohereResult = await resolved.client.rerank(
          normalized,
          candidates.map((c) => c.document),
          candidates.length,
        );

        const validResults = cohereResult.results.filter(
          (r) => r.index >= 0 && r.index < candidates.length,
        );
        const outputIds = validResults.map((r) => candidates[r.index]!.id);
        const cohereScores = validResults.map((r) => r.relevanceScore);

        ctx.summary = {
          inputScores,
          scoreSpread: computeScoreSpread(cohereScores),
          topScoreRatio: computeTopScoreRatio(cohereScores),
          cohereScores,
          rerankDelta: computeRerankDelta(inputIds, outputIds),
          cacheHit: false,
          candidateCount: candidates.length,
          queryCategory: meta.category,
        };
        // $0.002/search at overage; free tier included 1000/month. Upgrade: read from service registry.
        ctx.costUsd = 0.002;

        return cohereResult;
      },
      { summary: {} },
    )) as CohereRerankResult;

    const validResults = result.results.filter(
      (r) => r.index >= 0 && r.index < candidates.length,
    );
    const reordered = validResults.map((r) => candidates[r.index]!);

    // Write to cache
    await resolved.cache.set(
      normalized,
      cacheReranker,
      reordered.map((c) => c.id),
    );

    return reordered;
  } catch (error) {
    // Fail-open: return original order
    console.warn(
      "[cohere-rerank] fail-open:",
      error instanceof Error ? error.message : String(error),
    );
    return [...candidates];
  }
}
