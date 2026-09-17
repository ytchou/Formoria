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
  if (scores.length < 2 || scores[0] === 0) return 0;
  return scores[0]! / (scores[1] || 1);
}

// ---------------------------------------------------------------------------
// Default deps factory
// ---------------------------------------------------------------------------

export function createDefaultRerankDeps(): RerankDeps {
  return {
    client: createCohereRerankClient(),
    cache: getDefaultRerankCache(),
  };
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

  const normalized = normalizeSituationQuery(query);

  // Check cache
  const cachedIds = await resolved.cache.get(normalized, "cohere");
  if (cachedIds) {
    const byId = new Map(candidates.map((c) => [c.id, c]));
    return cachedIds
      .map((id) => byId.get(id))
      .filter((c): c is RerankCandidate => c !== undefined);
  }

  try {
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
          query,
          candidates.map((c) => c.document),
          50,
        );

        const outputIds = cohereResult.results.map(
          (r) => candidates[r.index]!.id,
        );
        const cohereScores = cohereResult.results.map(
          (r) => r.relevanceScore,
        );

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
        ctx.costUsd = 0.002;

        return cohereResult;
      },
      { summary: {} },
    )) as CohereRerankResult;

    const reordered = result.results.map((r) => candidates[r.index]!);

    // Write to cache
    await resolved.cache.set(
      normalized,
      "cohere",
      reordered.map((c) => c.id),
    );

    return reordered;
  } catch {
    // Fail-open: return original order
    return [...candidates];
  }
}
