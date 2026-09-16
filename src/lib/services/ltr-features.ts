import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Feature spec — the 20 features in documented order
// ---------------------------------------------------------------------------

export const FEATURE_SPEC = [
  { name: "rrf_score", source: "rpc" },
  { name: "vector_rank", source: "rpc" },
  { name: "lexical_rank", source: "rpc" },
  { name: "cosine_sim", source: "rpc" },
  { name: "lexical_score", source: "rpc" },
  { name: "in_vector_arm", source: "derived" },
  { name: "in_lexical_arm", source: "derived" },
  { name: "bigram_overlap", source: "derived" },
  { name: "brand_name_hit", source: "derived" },
  { name: "product_name_hit", source: "derived" },
  { name: "desc_zh_len", source: "derived" },
  { name: "desc_en_len", source: "derived" },
  { name: "has_image", source: "derived" },
  { name: "image_area", source: "derived" },
  { name: "has_subcategory", source: "derived" },
  { name: "material_count", source: "derived" },
  { name: "faq_count", source: "derived" },
  { name: "seo_promoted", source: "derived" },
  { name: "made_in_taiwan_confirmed", source: "derived" },
  { name: "product_name_len", source: "derived" },
] as const;

export const FEATURE_NAMES = Object.freeze(
  FEATURE_SPEC.map((f) => f.name),
) as readonly string[];

export const featureSpecHash: string = createHash("sha256")
  .update(JSON.stringify(FEATURE_SPEC))
  .digest("hex");

// ---------------------------------------------------------------------------
// Column allowlist — what the model may read
// ---------------------------------------------------------------------------

export const LTR_ALLOWED_COLUMNS = new Set([
  "curated_products.name_zh",
  "curated_products.name_en",
  "curated_products.product_description_zh",
  "curated_products.product_description_en",
  "curated_products.image_url",
  "curated_products.image_width",
  "curated_products.image_height",
  "curated_products.material",
  "curated_products.subcategory",
  "curated_products.made_in_taiwan_confirmed",
  "brands.name",
  "brands.seo_promoted",
  "brands.model_faq_count",
]);

export const LTR_DOC_SELECT =
  "id, name_zh, name_en, product_description_zh, product_description_en, image_url, image_width, image_height, material, subcategory, made_in_taiwan_confirmed, brand:brands!curated_products_brand_id_fkey(name, seo_promoted, model_faq_count)";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DocFeatures = {
  id: string;
  name_zh: string;
  name_en: string | null;
  product_description_zh: string;
  product_description_en: string | null;
  image_url: string | null;
  image_width: number | null;
  image_height: number | null;
  material: string[];
  subcategory: string | null;
  made_in_taiwan_confirmed: boolean;
  brand: {
    name: string;
    seo_promoted: boolean;
    model_faq_count: number | null;
  };
};

export type RpcRow = {
  product_id: string;
  rank_score: number;
  search_source: string;
  vector_rank: number | null;
  lexical_rank: number | null;
  cosine_sim: number | null;
  lexical_score: number | null;
};

// ---------------------------------------------------------------------------
// Minimal Supabase client interface for DI
// ---------------------------------------------------------------------------

type SupabaseSelectChain = {
  in: (column: string, values: string[]) => Promise<{ data: DocFeatures[] | null; error: unknown }>;
};

type SupabaseFromChain = {
  select: (query: string) => SupabaseSelectChain;
};

type MinimalClient = {
  from: (table: string) => SupabaseFromChain;
};

// ---------------------------------------------------------------------------
// fetchDocFeatures — reads only allowlisted columns, chunks by 100
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 100;

export async function fetchDocFeatures(
  ids: string[],
  client?: MinimalClient,
): Promise<Map<string, DocFeatures>> {
  if (ids.length === 0) return new Map();

  const resolvedClient = client ?? (await getDefaultClient());
  const result = new Map<string, DocFeatures>();

  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const { data, error } = await resolvedClient
      .from("curated_products")
      .select(LTR_DOC_SELECT)
      .in("id", chunk);

    if (error) throw error;
    if (data) {
      for (const row of data) {
        result.set(row.id, row);
      }
    }
  }

  return result;
}

async function getDefaultClient(): Promise<MinimalClient> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  return createServiceClient() as unknown as MinimalClient;
}

// ---------------------------------------------------------------------------
// bigramOverlap — CJK bigram overlap between query and document
// ---------------------------------------------------------------------------

// CJK Unified Ideographs (U+4E00..U+9FFF) + Extension A (U+3400..U+4DBF)
const CJK_RUN = new RegExp("[\\u4E00-\\u9FFF\\u3400-\\u4DBF]+", "g");
const MAX_BIGRAMS = 40;

export function bigramOverlap(query: string, document: string): number {
  const normQuery = query.normalize("NFKC");
  const queryBigrams = extractCjkBigrams(normQuery);
  if (queryBigrams.size === 0) return 0;

  const cappedBigrams = cappedSet(queryBigrams, MAX_BIGRAMS);
  const normDoc = document.normalize("NFKC");
  const docBigrams = extractCjkBigrams(normDoc);

  let hits = 0;
  for (const bg of cappedBigrams) {
    if (docBigrams.has(bg)) hits++;
  }

  return hits / cappedBigrams.size;
}

function extractCjkBigrams(text: string): Set<string> {
  const bigrams = new Set<string>();
  let match: RegExpExecArray | null;
  CJK_RUN.lastIndex = 0;
  while ((match = CJK_RUN.exec(text)) !== null) {
    const run = match[0];
    for (let i = 0; i < run.length - 1; i++) {
      bigrams.add(run.substring(i, i + 2));
    }
  }
  return bigrams;
}

function cappedSet(source: Set<string>, max: number): Set<string> {
  if (source.size <= max) return source;
  const capped = new Set<string>();
  for (const v of source) {
    capped.add(v);
    if (capped.size >= max) break;
  }
  return capped;
}

// ---------------------------------------------------------------------------
// Hit helpers
// ---------------------------------------------------------------------------

function brandNameHit(query: string, brandName: string): number {
  if (!brandName) return 0;
  const normQ = query.normalize("NFKC").toLowerCase();
  const normB = brandName.normalize("NFKC").toLowerCase();
  return normQ.includes(normB) ? 1 : 0;
}

function productNameHit(
  query: string,
  nameZh: string,
  nameEn: string | null,
): number {
  const normQ = query.normalize("NFKC").toLowerCase();
  if (nameZh && normQ.includes(nameZh.normalize("NFKC").toLowerCase())) {
    return 1;
  }
  if (nameEn && normQ.includes(nameEn.normalize("NFKC").toLowerCase())) {
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// buildFeatureRows — maps RPC + doc features to Float32Array[]
// ---------------------------------------------------------------------------

export function buildFeatureRows(
  query: string,
  rpcRows: RpcRow[],
  docs: Map<string, DocFeatures>,
): Float32Array[] {
  return rpcRows.map((rpc) => {
    const doc = docs.get(rpc.product_id);
    const row = new Float32Array(FEATURE_NAMES.length);

    // 0: rrf_score
    row[0] = rpc.rank_score;
    // 1: vector_rank (absent → 101)
    row[1] = rpc.vector_rank ?? 101;
    // 2: lexical_rank (absent → 101)
    row[2] = rpc.lexical_rank ?? 101;
    // 3: cosine_sim (absent → 0)
    row[3] = rpc.cosine_sim ?? 0;
    // 4: lexical_score (absent → 0)
    row[4] = rpc.lexical_score ?? 0;
    // 5: in_vector_arm
    row[5] = rpc.vector_rank != null ? 1 : 0;
    // 6: in_lexical_arm
    row[6] = rpc.lexical_rank != null ? 1 : 0;

    if (!doc) return row; // remaining features stay 0

    // 7: bigram_overlap
    row[7] = bigramOverlap(query, doc.product_description_zh ?? "");
    // 8: brand_name_hit
    row[8] = brandNameHit(query, doc.brand?.name ?? "");
    // 9: product_name_hit
    row[9] = productNameHit(query, doc.name_zh, doc.name_en);
    // 10: desc_zh_len
    row[10] = Math.log1p((doc.product_description_zh ?? "").length);
    // 11: desc_en_len
    row[11] = Math.log1p((doc.product_description_en ?? "").length);
    // 12: has_image
    row[12] = doc.image_url != null ? 1 : 0;
    // 13: image_area
    row[13] = Math.log1p((doc.image_width ?? 0) * (doc.image_height ?? 0));
    // 14: has_subcategory
    row[14] = doc.subcategory != null ? 1 : 0;
    // 15: material_count
    row[15] = (doc.material ?? []).length;
    // 16: faq_count
    row[16] = Math.log1p(doc.brand?.model_faq_count ?? 0);
    // 17: seo_promoted
    row[17] = doc.brand?.seo_promoted ? 1 : 0;
    // 18: made_in_taiwan_confirmed
    row[18] = doc.made_in_taiwan_confirmed ? 1 : 0;
    // 19: product_name_len
    row[19] = Math.log1p(doc.name_zh.length);

    return row;
  });
}
