import crypto from "node:crypto";
import { EMBEDDING_MODEL } from "@/lib/constants/llm-models";
import { getRelatedBrands, getBrandsBySlugs } from "./brands";
import type { Brand } from "@/lib/types/brand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BrandProductGroup = {
  brandId: string;
  productIds: string[];
  embeddings: number[][];
  sourceHashes: string[];
};

type CentroidUpsertRow = {
  brand_id: string;
  embedding: string;
  model: string;
  source_hash: string;
  product_count: number;
};

type WriterInput = {
  upserts: CentroidUpsertRow[];
  deletes: string[];
};

type RefreshOptions = {
  dryRun?: boolean;
  reader?: () => Promise<BrandProductGroup[]>;
  writer?: (input: WriterInput, existing?: Map<string, string>) => Promise<void>;
  existingReader?: () => Promise<Map<string, string>>;
};

type RefreshResult = {
  updated: number;
  deleted: number;
  skipped: number;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Element-wise mean using Float64Array to avoid precision drift. */
export function computeCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  const dim = embeddings[0]!.length;
  const acc = new Float64Array(dim);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      acc[i] += emb[i]!;
    }
  }
  const count = embeddings.length;
  const result = new Array<number>(dim);
  for (let i = 0; i < dim; i++) {
    result[i] = acc[i]! / count;
  }
  return result;
}

/**
 * Deterministic hash of the product set that contributed to this centroid.
 * Sort by product_id, concatenate `id:hash` pairs, SHA-256 hex.
 */
export function buildSourceHash(
  entries: { productId: string; sourceHash: string }[],
): string {
  const sorted = [...entries].sort((a, b) =>
    a.productId.localeCompare(b.productId),
  );
  const payload = sorted.map((e) => `${e.productId}:${e.sourceHash}`).join(",");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

// ---------------------------------------------------------------------------
// Default reader / writer (Supabase)
// ---------------------------------------------------------------------------

const PAGE_SIZE = 500;

async function defaultReader(): Promise<BrandProductGroup[]> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const supabase = createServiceClient();

  // Paginate over product_embeddings joined with curated_products
  type Row = {
    brand_id: string;
    product_id: string;
    embedding: number[];
    source_hash: string;
  };

  const rows: Row[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("product_embeddings")
      .select(
        "product_id, embedding, source_hash, curated_products!inner(brand_id)",
      )
      .order("product_id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const cp = row.curated_products as unknown as { brand_id: string };
      rows.push({
        brand_id: cp.brand_id,
        product_id: row.product_id,
        embedding: typeof row.embedding === "string"
          ? JSON.parse(row.embedding)
          : row.embedding,
        source_hash: row.source_hash,
      });
    }

    from += data.length;
    if (data.length < PAGE_SIZE) break;
  }

  // Group by brand_id
  const groups = new Map<string, BrandProductGroup>();
  for (const row of rows) {
    let group = groups.get(row.brand_id);
    if (!group) {
      group = {
        brandId: row.brand_id,
        productIds: [],
        embeddings: [],
        sourceHashes: [],
      };
      groups.set(row.brand_id, group);
    }
    group.productIds.push(row.product_id);
    group.embeddings.push(row.embedding);
    group.sourceHashes.push(row.source_hash);
  }

  return [...groups.values()];
}

async function defaultExistingReader(): Promise<Map<string, string>> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const supabase = createServiceClient();

  const existing = new Map<string, string>();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("brand_embeddings")
      .select("brand_id, source_hash")
      .order("brand_id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const row of data) {
      existing.set(row.brand_id, row.source_hash);
    }
    from += data.length;
    if (data.length < PAGE_SIZE) break;
  }
  return existing;
}

async function defaultWriter(input: WriterInput): Promise<void> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const supabase = createServiceClient();

  if (input.upserts.length > 0) {
    const { error } = await supabase
      .from("brand_embeddings")
      .upsert(input.upserts, { onConflict: "brand_id" });
    if (error) throw new Error(error.message);
  }

  if (input.deletes.length > 0) {
    const { error } = await supabase
      .from("brand_embeddings")
      .delete()
      .in("brand_id", input.deletes);
    if (error) throw new Error(error.message);
  }
}

// ---------------------------------------------------------------------------
// refreshBrandCentroids
// ---------------------------------------------------------------------------

export async function refreshBrandCentroids(
  options: RefreshOptions = {},
): Promise<RefreshResult> {
  const { dryRun = false, reader, writer, existingReader } = options;

  const groups = await (reader ?? defaultReader)();
  const existing = await (existingReader ?? defaultExistingReader)();

  // Build centroid for each brand and compute source hash
  const upserts: CentroidUpsertRow[] = [];
  let skipped = 0;

  for (const group of groups) {
    const entries = group.productIds.map((pid, i) => ({
      productId: pid,
      sourceHash: group.sourceHashes[i]!,
    }));
    const hash = buildSourceHash(entries);

    if (existing.get(group.brandId) === hash) {
      skipped++;
      continue;
    }

    const centroid = computeCentroid(group.embeddings);
    upserts.push({
      brand_id: group.brandId,
      embedding: JSON.stringify(centroid),
      model: EMBEDDING_MODEL,
      source_hash: hash,
      product_count: group.embeddings.length,
    });
  }

  // Identify orphaned centroids (brands no longer having products)
  const activeBrandIds = new Set(groups.map((g) => g.brandId));
  const deletes = [...existing.keys()].filter(
    (brandId) => !activeBrandIds.has(brandId),
  );

  if (dryRun) {
    return { updated: 0, deleted: 0, skipped };
  }

  const write = writer ?? defaultWriter;
  if (upserts.length > 0 || deletes.length > 0) {
    await write({ upserts, deletes }, existing);
  }

  return {
    updated: upserts.length,
    deleted: deletes.length,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// getRelatedBrandsByCentroid — DI overrides for testing
// ---------------------------------------------------------------------------

type RpcResult = { slug: string; distance: number };

type RpcCallParams = {
  embedding: number[];
  filterCategory: string;
  excludeBrandId: string;
  matchCount: number;
};

type RelatedBrandsDeps = {
  centroidReader?: (brandId: string) => Promise<number[] | null>;
  rpcCaller?: (params: RpcCallParams) => Promise<RpcResult[]>;
  countReader?: (categorySlug: string) => Promise<number>;
};

async function defaultCentroidReader(
  brandId: string,
): Promise<number[] | null> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brand_embeddings")
    .select("embedding")
    .eq("brand_id", brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return typeof data.embedding === "string"
    ? JSON.parse(data.embedding)
    : data.embedding;
}

async function defaultRpcCaller(params: RpcCallParams): Promise<RpcResult[]> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("search_brands_by_centroid", {
    query_embedding: JSON.stringify(params.embedding),
    filter_category: params.filterCategory,
    exclude_brand_id: params.excludeBrandId,
    match_count: params.matchCount,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { brand_slug: string; distance: number }[]).map(
    (row) => ({ slug: row.brand_slug, distance: row.distance }),
  );
}

async function defaultCountReader(categorySlug: string): Promise<number> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("brands")
    .select("id", { count: "exact", head: true })
    .eq("category", categorySlug)
    .eq("status", "approved")
    .not("is_demo", "eq", true);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// L2 diversity filter — pure function
// ---------------------------------------------------------------------------

/**
 * Filter RPC results to enforce at most one brand per L2 subcategory.
 * Brands with null/empty subcategories always pass. Preserves input order.
 */
function applyL2Diversity(
  candidates: RpcResult[],
  brandMap: Map<string, Brand>,
  limit: number,
): RpcResult[] {
  const seenL2 = new Set<string>();
  const accepted: RpcResult[] = [];

  for (const candidate of candidates) {
    if (accepted.length >= limit) break;

    const brand = brandMap.get(candidate.slug);
    if (!brand) continue;

    const subs = brand.subcategories;
    if (!subs || subs.length === 0) {
      accepted.push(candidate);
      continue;
    }

    const overlaps = subs.some((s) => seenL2.has(s));
    if (!overlaps) {
      for (const s of subs) seenL2.add(s);
      accepted.push(candidate);
    }
  }

  return accepted;
}

// ---------------------------------------------------------------------------
// getRelatedBrandsByCentroid
// ---------------------------------------------------------------------------

export async function getRelatedBrandsByCentroid(
  brandId: string,
  categorySlug: string,
  excludeSlug: string,
  limit = 4,
  deps: RelatedBrandsDeps = {},
): Promise<{ brands: Brand[]; totalCount: number }> {
  const readCentroid = deps.centroidReader ?? defaultCentroidReader;
  const callRpc = deps.rpcCaller ?? defaultRpcCaller;
  const readCount = deps.countReader ?? defaultCountReader;

  // 1. Read source brand centroid
  const embedding = await readCentroid(brandId);

  // 2. Fallback to random if no centroid
  if (!embedding) {
    return getRelatedBrands(categorySlug, excludeSlug, limit);
  }

  // 3. Call RPC with over-fetch for diversity filtering
  const matchCount = limit * 3;
  const rpcResults = await callRpc({
    embedding,
    filterCategory: categorySlug,
    excludeBrandId: brandId,
    matchCount,
  });

  // Filter out source brand (belt-and-suspenders; SQL already excludes by brand_id)
  const filtered = rpcResults.filter((r) => r.slug !== excludeSlug);

  // 4. Hydrate slugs
  const slugs = filtered.map((r) => r.slug);
  const brandMap = await getBrandsBySlugs(slugs);

  // 5. L2 diversity filter
  const diverse = applyL2Diversity(filtered, brandMap, limit);

  // 6. Count
  const totalCount = await readCount(categorySlug);

  // 7. Re-order by original distance rank (already in order from filtered)
  const brands = diverse
    .map((r) => brandMap.get(r.slug))
    .filter((b): b is Brand => b !== undefined);

  return { brands, totalCount };
}
