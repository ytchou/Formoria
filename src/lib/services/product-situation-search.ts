import { createServiceClient } from "@/lib/supabase/service";
import { createAuditedEmbeddingsClient } from "@/lib/services/embeddings-audit";
import { getPublishedCuratedProducts } from "@/lib/services/curated-products-catalog";
import {
  getDefaultQueryEmbeddingCache,
  type QueryEmbeddingCache,
} from "@/lib/cache/query-embedding-cache";
import { EMBEDDING_MODEL } from "@/lib/constants/llm-models";
import * as Sentry from "@sentry/nextjs";
import { parseQueryIntent, type IntentParseOutcome } from "./query-intent-parse";
import { isVisibleCategory } from "@/lib/taxonomy/ontology";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { CatalogProduct } from "@/lib/services/curated-products-catalog";

export type SearchMode = "hybrid" | "vector" | "lexical";

export type SearchInput = {
  query: string;
  locale: "zh-TW" | "en";
  mode?: SearchMode;
  page?: number;
  pageSize?: number;
  category?: string | null;
  subcategories?: string[];
  materials?: string[];
  sort?: "relevance" | "newest" | "alphabetical";
  audit?: { jobId?: string; phase?: string };
  enableIntentParse?: boolean;
};

export type SearchResult = {
  products: CatalogProduct[];
  totalCount: number;
  searchSource: SearchMode;
  degraded: boolean;
  query: string;
  intentParsed: 'skipped' | 'ok' | 'failed';
  intentCategory: string | null;
  intentSubcategory: string | null;
  intentMaterials: string[];
  intentCacheHit: boolean;
  intentLatencyMs: number;
  rpcLatencyMs: number;
  embedLatencyMs: number;
  searchId: string;
};

export type SimilarResult = {
  products: CatalogProduct[];
};

type RpcRow = {
  product_id: string;
  rank_score: number;
  search_source: string;
};

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export type SituationQueryErrorCode = "too_short" | "too_long" | "empty";

export class SituationQueryError extends Error {
  code: SituationQueryErrorCode;

  constructor(code: SituationQueryErrorCode, message: string) {
    super(message);
    this.name = "SituationQueryError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

const WILDCARD_ONLY = /^[*%_?]+$/;

export function normalizeSituationQuery(raw: string): string {
  // NFKC normalize, then replace full-width and half-width spaces with a single space, trim
  const normalized = raw
    .normalize("NFKC")
    .replace(/[\s　]+/g, " ")
    .trim();

  if (normalized.length === 0 || WILDCARD_ONLY.test(normalized)) {
    throw new SituationQueryError("empty", "Query is empty");
  }
  if (normalized.length < 2) {
    throw new SituationQueryError(
      "too_short",
      `Query must be at least 2 characters, got ${normalized.length}`,
    );
  }
  if (normalized.length > 200) {
    throw new SituationQueryError(
      "too_long",
      `Query must be at most 200 characters, got ${normalized.length}`,
    );
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

type EmbedFn = (
  text: string,
  ctx: { phase: string; jobId?: string },
) => Promise<number[]>;

type RpcFn = (
  name: string,
  params: Record<string, unknown>,
) => Promise<{ data: RpcRow[] | null; error: Error | null }>;

type HydrateFn = (opts: { ids: string[] }) => Promise<CatalogProduct[]>;

export type SearchDeps = {
  embed: EmbedFn;
  rpc: RpcFn;
  hydrate: HydrateFn;
  cache: Pick<QueryEmbeddingCache, "get" | "set">;
  report: (error: unknown) => void;
  now: () => number;
  /** Read the stored embedding for a product. Used by findSimilarProducts. */
  readProductEmbedding?: (productId: string) => Promise<number[] | null>;
  /** LLM-based intent extraction for structured filter discovery. */
  parseIntent?: (query: string) => Promise<IntentParseOutcome>;
};

const DEGRADE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Module-level degradation timestamp for deduped Sentry reports.
 * Shared across all calls within a process — intentionally not per-deps
 * so that a single process does not flood.
 */
let lastDegradationReportAt = -Infinity;

/** @internal Test-only — reset the module-level cooldown timestamp. */
export function _resetDegradationCooldown(): void {
  lastDegradationReportAt = -Infinity;
}

function defaultDeps(): SearchDeps {
  const client = createServiceClient();
  return {
    embed: async (text, ctx) => {
      const auditedClient = createAuditedEmbeddingsClient({
        phase: ctx?.phase ?? "situation_search",
        jobId: ctx?.jobId,
      });
      const result = await auditedClient.embed([text]);
      return result.vectors[0]!;
    },
    rpc: async (name, params) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RpcFn uses string keys for the test seam; Supabase .rpc() expects literal function names
      const { data, error } = await client.rpc(name as "search_products_semantic", params as any);
      return { data: data as RpcRow[] | null, error };
    },
    hydrate: async ({ ids }) => {
      const result = await getPublishedCuratedProducts({ ids });
      return result.products;
    },
    cache: getDefaultQueryEmbeddingCache(),
    report: (error) => {
      Sentry.captureException(error);
    },
    now: () => Date.now(),
    readProductEmbedding: async (productId: string) => {
      const { data, error } = await client
        .from("product_embeddings")
        .select("embedding")
        .eq("product_id", productId)
        .single();
      if (error || !data?.embedding) return null;
      return typeof data.embedding === "string"
        ? JSON.parse(data.embedding)
        : data.embedding;
    },
    parseIntent: (query) => parseQueryIntent(query),
  };
}

// ---------------------------------------------------------------------------
// searchProductsBySituation
// ---------------------------------------------------------------------------

/**
 * Fixed pool size sent to the RPC as `match_count`. Mirrors
 * `least(greatest(match_count,1),100)` in
 * `20260915140000_situation_search_pool_100.sql`.
 *
 * Ceiling is the hydrate payload — slice ids before hydrating for `relevance`
 * sort if p95 moves.
 */
export const CANDIDATE_POOL = 100;

export async function searchProductsBySituation(
  input: SearchInput,
  deps: SearchDeps = defaultDeps(),
): Promise<SearchResult> {
  const searchId = crypto.randomUUID();
  const normalized = normalizeSituationQuery(input.query);
  const mode = input.mode ?? "hybrid";
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  const sort = input.sort ?? "relevance";

  // --- Parallel: intent parse + embed ---
  const intentStart = deps.now();
  const shouldParse = input.enableIntentParse && deps.parseIntent;

  let intentLatencyMs = 0;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const intentParsePromise: Promise<IntentParseOutcome> = shouldParse
    ? Promise.race([
        deps.parseIntent!(normalized).catch(() => null).then((result) => {
          intentLatencyMs = deps.now() - intentStart;
          return result;
        }),
        new Promise<null>((resolve) => {
          timeoutId = setTimeout(() => {
            intentLatencyMs = 2000;
            resolve(null);
          }, 2000);
        }),
      ])
    : Promise.resolve(null);

  async function doEmbed(): Promise<{
    embedding: number[] | null;
    degraded: boolean;
    effectiveMode: SearchMode;
    embedLatencyMs: number;
  }> {
    let embedding: number[] | null = null;
    let degraded = false;
    let effectiveMode: SearchMode = mode;

    if (mode !== "lexical") {
      const t0 = deps.now();
      const cached = await deps.cache.get(normalized, EMBEDDING_MODEL);
      if (cached) {
        embedding = cached;
      } else {
        try {
          const ctx: { phase: string; jobId?: string } = {
            phase: input.audit?.phase ?? "situation_search",
            ...(input.audit?.jobId ? { jobId: input.audit.jobId } : {}),
          };
          embedding = await deps.embed(normalized, ctx);
          await deps.cache.set(normalized, EMBEDDING_MODEL, embedding);
        } catch (err) {
          degraded = true;
          effectiveMode = "lexical";
          embedding = null;

          const now = deps.now();
          if (now - lastDegradationReportAt >= DEGRADE_COOLDOWN_MS) {
            lastDegradationReportAt = now;
            deps.report(err);
          }
        }
      }
      const embedLatencyMs = deps.now() - t0;
      return { embedding, degraded, effectiveMode, embedLatencyMs };
    }

    return { embedding, degraded, effectiveMode, embedLatencyMs: 0 };
  }

  const [intentOutcome, embedResult] = await Promise.all([
    intentParsePromise,
    doEmbed(),
  ]);

  if (timeoutId) clearTimeout(timeoutId);
  const { embedding, degraded, effectiveMode, embedLatencyMs } = embedResult;

  // --- Intent metadata (populated on both returns) ---
  const intentMeta = {
    intentParsed: !shouldParse ? 'skipped' as const : intentOutcome !== null ? 'ok' as const : 'failed' as const,
    intentCategory: intentOutcome?.parsed?.category ?? null,
    intentSubcategory: intentOutcome?.parsed?.subcategory ?? null,
    intentMaterials: intentOutcome?.parsed?.materials ?? [],
    intentCacheHit: intentOutcome?.cacheHit ?? false,
    intentLatencyMs,
  };

  // --- Merge filters: user-selected wins over LLM-extracted ---
  const parsed = intentOutcome?.parsed ?? null;

  // F2: Filter LLM category through visibility check (hidden/deferred categories dropped)
  const parsedCategory = parsed?.category && isVisibleCategory(parsed.category) ? parsed.category : null;

  // F5: Only use LLM subcategory when compatible with the resolved category
  const resolvedCategory = input.category ?? parsedCategory ?? null;
  const parsedSubcategory = parsed?.subcategory ?? null;
  const useSubcategory = parsedSubcategory && resolvedCategory && parsed?.category === resolvedCategory;

  const rpcParams: Record<string, unknown> = {
    query_text: normalized,
    query_embedding: embedding,
    mode: effectiveMode,
    match_count: CANDIDATE_POOL,
    filter_category: input.category ?? parsedCategory ?? null,
    filter_subcategories: input.subcategories?.length
      ? input.subcategories
      : useSubcategory
        ? [parsedSubcategory]
        : null,
    filter_materials: input.materials?.length
      ? input.materials
      : parsed?.materials?.length
        ? parsed.materials
        : null,
  };

  const rpcStart = deps.now();
  const { data: rpcRows, error: rpcError } = await deps.rpc(
    "search_products_semantic",
    rpcParams,
  );
  const rpcLatencyMs = deps.now() - rpcStart;

  if (rpcError) {
    throw rpcError;
  }

  const rows = rpcRows ?? [];
  const orderedIds = rows.map((r) => r.product_id);

  if (orderedIds.length === 0) {
    return {
      products: [],
      totalCount: 0,
      searchSource: effectiveMode,
      degraded,
      query: normalized,
      rpcLatencyMs,
      embedLatencyMs,
      searchId,
      ...intentMeta,
    };
  }

  // --- Hydrate ---
  const hydrated = await deps.hydrate({ ids: orderedIds });

  // Reorder by RPC rank order
  const byId = new Map(hydrated.map((p) => [p.id, p]));
  let ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((p): p is CatalogProduct => p != null);

  // --- Sort ---
  if (sort === "newest") {
    ordered = [...ordered].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  } else if (sort === "alphabetical") {
    ordered = [...ordered].sort((a, b) => a.nameZh.localeCompare(b.nameZh));
  }
  // "relevance" keeps RPC order

  // --- Paginate ---
  const totalCount = ordered.length;
  const start = (page - 1) * pageSize;
  const paged = ordered.slice(start, start + pageSize);

  return {
    products: paged,
    totalCount,
    searchSource: effectiveMode,
    degraded,
    query: normalized,
    rpcLatencyMs,
    embedLatencyMs,
    searchId,
    ...intentMeta,
  };
}

// ---------------------------------------------------------------------------
// findSimilarProducts
// ---------------------------------------------------------------------------

export async function findSimilarProducts(
  productId: string,
  limit = 5,
  deps: SearchDeps = defaultDeps(),
): Promise<SimilarResult> {
  // Fetch the product's stored embedding vector via the injected dep.
  const readEmbedding =
    deps.readProductEmbedding ?? defaultDeps().readProductEmbedding!;
  const storedEmbedding = await readEmbedding(productId);
  if (!storedEmbedding) {
    return { products: [] };
  }

  const { data: rpcRows, error } = await deps.rpc("search_products_semantic", {
    mode: "vector",
    match_count: limit + 1, // +1 to account for self
    query_text: null,
    query_embedding: storedEmbedding,
    filter_category: null,
    filter_subcategories: null,
    filter_materials: null,
  });

  if (error) throw error;

  // Remove the source product and truncate to limit
  const rows = (rpcRows ?? []).filter((r) => r.product_id !== productId);
  const ids = rows.slice(0, limit).map((r) => r.product_id);

  if (ids.length === 0) return { products: [] };

  const hydrated = await deps.hydrate({ ids });
  const byId = new Map(hydrated.map((p) => [p.id, p]));
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((p): p is CatalogProduct => p != null);

  return { products: ordered };
}

// ---------------------------------------------------------------------------
// findSimilarProductsForTrail
// ---------------------------------------------------------------------------

const DEFAULT_TRAIL_SIMILAR_LIMIT = 6;
const PER_PRODUCT_FETCH_LIMIT = 5;
const MAX_PER_BRAND = 1;

export async function findSimilarProductsForTrail(
  productIds: string[],
  limit = DEFAULT_TRAIL_SIMILAR_LIMIT,
  deps: SearchDeps = defaultDeps(),
): Promise<CatalogProduct[]> {
  if (productIds.length === 0) return [];

  const trailSet = new Set(productIds);
  const results = await Promise.all(
    productIds.map((id) => findSimilarProducts(id, PER_PRODUCT_FETCH_LIMIT, deps)),
  );

  const seen = new Set<string>();
  const brandCount = new Map<string, number>();
  const merged: CatalogProduct[] = [];

  for (let round = 0; merged.length < limit; round++) {
    let added = false;
    for (const result of results) {
      if (round >= result.products.length) continue;
      const p = result.products[round];
      if (trailSet.has(p.id) || seen.has(p.id)) continue;
      const hits = brandCount.get(p.brandSlug) ?? 0;
      if (hits >= MAX_PER_BRAND) continue;
      seen.add(p.id);
      brandCount.set(p.brandSlug, hits + 1);
      merged.push(p);
      added = true;
      if (merged.length >= limit) break;
    }
    if (!added) break;
  }

  return merged;
}
