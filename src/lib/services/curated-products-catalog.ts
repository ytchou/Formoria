import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { excludeTestBrands } from "@/lib/services/public-brand-filter";
import type { BrandVisitLinkFields } from "@/lib/brands/link-fallback";
import { L2_SUBCATEGORIES, subcategoryBySlug } from "@/lib/taxonomy/ontology";
import { hasRenderableCuratedImage } from "@/lib/curated-products/image-eligibility";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The cross-brand projection the /discover catalog renders. */
export type CatalogProduct = {
  id: string;
  key: string;
  nameZh: string;
  nameEn: string | null;
  category: string;
  subcategory: string;
  material: string[];
  createdAt: string;
  imageUrl: string | null;
  officialUrl: string | null;
  brandSlug: string;
  brandName: string;
  productDescriptionZh: string;
  productDescriptionEn: string | null;
  brand: BrandVisitLinkFields & { slug: string };
};

type CatalogBrandRow = {
  slug: string;
  name: string;
  status?: string;
  purchase_website: string | null;
  purchase_pinkoi: string | null;
  purchase_shopee: string | null;
  purchase_myship: string | null;
  social_instagram: string | null;
  social_threads: string | null;
  social_facebook: string | null;
};

export type CatalogProductRow = {
  id: string;
  key: string;
  name_zh: string;
  name_en: string | null;
  category: string;
  subcategory?: string | null;
  subcategories?: string[] | null;
  material?: string[] | null;
  created_at: string;
  image_url: string | null;
  official_url: string | null;
  product_description_zh: string;
  product_description_en?: string | null;
  brands: CatalogBrandRow | null;
};

// ---------------------------------------------------------------------------
// Transformer — exported for tests (no Supabase mock needed)
// ---------------------------------------------------------------------------

function canonicalCatalogSubcategory(row: CatalogProductRow): string | null {
  const candidate =
    typeof row.subcategory === "string"
      ? row.subcategory
      : row.subcategories?.length === 1
        ? row.subcategories[0]!
        : null;
  const subcategory = candidate ? subcategoryBySlug(candidate) : null;
  return subcategory?.category === row.category ? subcategory.slug : null;
}

/** A row the catalog can render: a canonical L2 and a photo the tile shows. */
function isCatalogEligible(row: CatalogProductRow): boolean {
  return (
    canonicalCatalogSubcategory(row) !== null &&
    hasRenderableCuratedImage(row.image_url)
  );
}

export function transformCatalogRow(row: CatalogProductRow): CatalogProduct {
  const brand = row.brands;
  if (!brand) {
    throw new Error(`Catalog product ${row.id} is missing its brand`);
  }
  const subcategory = canonicalCatalogSubcategory(row);
  if (!subcategory) {
    throw new Error(
      `Catalog product ${row.id} is missing a canonical subcategory`,
    );
  }
  return {
    id: row.id,
    key: row.key,
    nameZh: row.name_zh,
    nameEn: row.name_en ?? null,
    category: row.category,
    subcategory,
    material: row.material ?? [],
    createdAt: row.created_at,
    imageUrl: row.image_url ?? null,
    officialUrl: row.official_url ?? null,
    brandSlug: brand.slug,
    brandName: brand.name,
    productDescriptionZh: row.product_description_zh,
    productDescriptionEn: row.product_description_en ?? null,
    brand: {
      slug: brand.slug,
      purchaseWebsite: brand.purchase_website ?? null,
      purchasePinkoi: brand.purchase_pinkoi ?? null,
      purchaseShopee: brand.purchase_shopee ?? null,
      purchaseMyship: brand.purchase_myship ?? null,
      socialInstagram: brand.social_instagram ?? null,
      socialThreads: brand.social_threads ?? null,
      socialFacebook: brand.social_facebook ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const catalogSelect = (legacy: boolean) => `
  id, key, name_zh, name_en, category, ${legacy ? "subcategories" : "subcategory"}, created_at,
  image_url, official_url, material, product_description_zh, product_description_en,
  curated_product_sources!inner(id),
  brands!inner(slug, name, status, purchase_website, purchase_pinkoi, purchase_shopee, purchase_myship, social_instagram, social_threads, social_facebook)
`;

const DEFAULT_PAGE_SIZE = 12;
const CATALOG_RANGE_SIZE = 500;
const CATALOG_MAX_RANGES = 200;

export type CatalogQueryOptions = {
  category?: string | null;
  /** Restrict the read to these L1 categories when `category` is unset.
   *  /discover passes its visible L1s so the unfiltered listing counts the
   *  same products as the sidebar's all-categories total. Ignored when `category` is set,
   *  when empty, and in ids mode. */
  categories?: readonly string[];
  subcategories?: string[];
  materials?: string[];
  sort?: "newest" | "alphabetical";
  page?: number;
  pageSize?: number;
  /** When set, fetch exactly these product ids and return them in this order.
   *  Ignores page, pageSize, and sort. Max 100. */
  ids?: string[];
};

type CatalogFilterQuery = {
  not(column: string, operator: string, value: string): CatalogFilterQuery;
};

/**
 * Published curated products for the /discover catalog, with optional category
 * filtering and pagination. Shares the publication/evidence gates of the
 * homepage read: visible, has official_url, source_checked_at, at least one
 * active source and approved brand. A product must also have a renderable
 * image (DEV-1962): `image_url` is required in the query, so ranges and
 * counts stay correct, and a URL the tile would not render is dropped in
 * TypeScript. A curated-selection tile without a photo renders a letter placeholder.
 */
export async function getPublishedCuratedProducts(
  options: CatalogQueryOptions = {},
  client?: Pick<SupabaseClient, "from">,
): Promise<{ products: CatalogProduct[]; totalCount: number }> {
  const {
    category,
    categories,
    subcategories,
    materials,
    sort = "newest",
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
    ids,
  } = options;
  const supabase: Pick<SupabaseClient, "from"> =
    client ??
    (createServiceClient() as unknown as Pick<SupabaseClient, "from">);

  // ---- ids mode: single fetch, caller-order, no pagination ----
  if (ids && ids.length > 0) {
    const IDS_MAX = 100;
    const readByIds = async (
      legacy: boolean,
    ): Promise<CatalogProductRow[]> => {
      const query = supabase
        .from("curated_products")
        .select(catalogSelect(legacy))
        .in("id", ids)
        .eq("visible", true)
        .not("official_url", "is", null)
        .not("source_checked_at", "is", null)
        .not("image_url", "is", null)
        .eq("curated_product_sources.state", "active")
        .eq("brands.status", "approved");
      const filtered = excludeTestBrands(
        query as unknown as CatalogFilterQuery,
        "brands.name",
      ) as unknown as typeof query;
      const { data, error } = await filtered
        .order("id", { ascending: true })
        .range(0, IDS_MAX - 1);
      if (error) throw error;
      return (data ?? []) as unknown as CatalogProductRow[];
    };

    let rawRows: CatalogProductRow[];
    try {
      rawRows = await readByIds(false);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const message = (error as { message?: string }).message ?? "";
      if (
        (code !== "42703" && code !== "PGRST204") ||
        !/\bsubcategory\b/u.test(message)
      ) {
        throw error;
      }
      rawRows = await readByIds(true);
    }

    const products = rawRows
      .filter(isCatalogEligible)
      .map(transformCatalogRow);

    // Reorder to match the caller's ids order
    const orderMap = new Map(ids.map((id, i) => [id, i]));
    products.sort(
      (a, b) => (orderMap.get(a.id) ?? ids.length) - (orderMap.get(b.id) ?? ids.length),
    );

    return { products, totalCount: products.length };
  }

  // ---- standard catalog mode ----
  const filters: CatalogFilters = {
    category,
    categories,
    subcategories,
    materials,
    sort,
  };
  // An injected client (tests, one-off scripts) always reads fresh.
  const ordered = client
    ? await readOrderedCatalog(supabase, filters)
    : await memoizedOrderedCatalog(filters);
  const offset = (page - 1) * pageSize;
  return {
    products: ordered.slice(offset, offset + pageSize),
    totalCount: ordered.length,
  };
}

type CatalogFilters = Required<
  Pick<CatalogQueryOptions, "sort">
> &
  Pick<
    CatalogQueryOptions,
    "category" | "categories" | "subcategories" | "materials"
  >;

/** Every product matching `filters`, in display order (before pagination). */
async function readOrderedCatalog(
  supabase: Pick<SupabaseClient, "from">,
  filters: CatalogFilters,
): Promise<CatalogProduct[]> {
  const { category, categories, subcategories, materials, sort } = filters;
  const readAll = async (legacy: boolean): Promise<CatalogProductRow[]> => {
    const rows: CatalogProductRow[] = [];
    for (let range = 0; range < CATALOG_MAX_RANGES; range += 1) {
      const from = range * CATALOG_RANGE_SIZE;
      let query = supabase
        .from("curated_products")
        .select(catalogSelect(legacy))
        .eq("visible", true)
        .not("official_url", "is", null)
        .not("source_checked_at", "is", null)
        .not("image_url", "is", null)
        .eq("curated_product_sources.state", "active")
        .eq("brands.status", "approved");
      if (category) query = query.eq("category", category);
      else if (categories && categories.length > 0) {
        query = query.in("category", [...categories]);
      }
      if (subcategories && subcategories.length > 0) {
        query = legacy
          ? query.overlaps("subcategories", subcategories)
          : query.in("subcategory", subcategories);
      }
      if (materials && materials.length > 0) {
        query = query.overlaps("material", materials);
      }
      const filtered = excludeTestBrands(
        query as unknown as CatalogFilterQuery,
        "brands.name",
      ) as unknown as typeof query;
      const sorted =
        sort === "alphabetical"
          ? filtered.order("name_zh", { ascending: true })
          : filtered.order("created_at", { ascending: false });
      const { data, error } = await sorted
        .order("id", { ascending: true })
        .range(from, from + CATALOG_RANGE_SIZE - 1);
      if (error) throw error;
      const pageRows = (data ?? []) as unknown as CatalogProductRow[];
      rows.push(...pageRows);
      if (pageRows.length < CATALOG_RANGE_SIZE) return rows;
    }
    throw new Error(
      `Discover catalog read exceeded ${CATALOG_MAX_RANGES} ranges`,
    );
  };

  let rawRows: CatalogProductRow[];
  try {
    rawRows = await readAll(false);
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = (error as { message?: string }).message ?? "";
    if (
      (code !== "42703" && code !== "PGRST204") ||
      !/\bsubcategory\b/u.test(message)
    ) {
      throw error;
    }
    rawRows = await readAll(true);
  }

  const allProducts = rawRows
    .filter(isCatalogEligible)
    .map(transformCatalogRow);
  return sort === "alphabetical"
    ? allProducts
    : interleaveCatalogProducts(allProducts);
}

// ---------------------------------------------------------------------------
// In-process memo of full catalog reads (DEV-1991)
// ---------------------------------------------------------------------------

/**
 * Every /discover page view re-read the whole catalog (3 ranges of 500 rows,
 * ~0.8–1 s on staging) to paginate 20 products. The memo keeps each filter
 * combination's ordered list for CATALOG_MEMO_TTL_MS and shares one in-flight
 * read between concurrent requests. The same memo backs situation-search
 * hydration (`peekCatalogSnapshot`).
 *
 * Shortcut: per-process memory with a fixed TTL, not `unstable_cache` — the
 * full list carries descriptions and exceeds the Next data cache's 2 MB entry
 * limit, which would fail silently. Ceiling: a product hidden or published in
 * admin shows up to CATALOG_MEMO_TTL_MS late on each replica (facet counts
 * already lag up to 1 h). Upgrade path: tag-based invalidation from the
 * admin curated-product actions, or a slim cached id index plus a per-page
 * ids read.
 */
const CATALOG_MEMO_TTL_MS = 5 * 60 * 1000;
/** Bounds memory: unfiltered + each L1 + a few common filter combinations. */
const CATALOG_MEMO_MAX_KEYS = 32;

type CatalogMemoEntry = {
  at: number;
  promise: Promise<CatalogProduct[]>;
  settled: CatalogProduct[] | null;
  byId: Map<string, CatalogProduct> | null;
};

const catalogMemo = new Map<string, CatalogMemoEntry>();

/** @internal Test-only — clear the catalog memo. */
export function _resetCatalogMemo(): void {
  catalogMemo.clear();
}

function memoKey(filters: CatalogFilters): string {
  const sorted = (values: readonly string[] | undefined) =>
    values && values.length > 0 ? [...values].sort() : null;
  return JSON.stringify([
    filters.category ?? null,
    filters.category ? null : sorted(filters.categories),
    sorted(filters.subcategories),
    sorted(filters.materials),
    filters.sort,
  ]);
}

function loadMemoEntry(filters: CatalogFilters): CatalogMemoEntry {
  const key = memoKey(filters);
  const now = Date.now();
  const existing = catalogMemo.get(key);
  if (existing && now - existing.at < CATALOG_MEMO_TTL_MS) return existing;

  const entry: CatalogMemoEntry = {
    at: now,
    promise: readOrderedCatalog(
      createServiceClient() as unknown as Pick<SupabaseClient, "from">,
      filters,
    ),
    settled: null,
    byId: null,
  };
  entry.promise.then(
    (products) => {
      entry.settled = products;
    },
    () => {
      // A failed read is never served from the memo; the caller still sees
      // the rejection through `entry.promise`.
      if (catalogMemo.get(key) === entry) catalogMemo.delete(key);
    },
  );
  catalogMemo.delete(key);
  catalogMemo.set(key, entry);
  while (catalogMemo.size > CATALOG_MEMO_MAX_KEYS) {
    const oldest = catalogMemo.keys().next().value;
    if (oldest === undefined) break;
    catalogMemo.delete(oldest);
  }
  return entry;
}

async function memoizedOrderedCatalog(
  filters: CatalogFilters,
): Promise<CatalogProduct[]> {
  return loadMemoEntry(filters).promise;
}

/** The unfiltered catalog: the same publication gates as ids mode. */
const SNAPSHOT_FILTERS: CatalogFilters = { sort: "newest" };

/**
 * Hydration lookup for situation search. Returns the memoized unfiltered
 * catalog by id when a fresh copy is already loaded, otherwise null — and
 * starts loading it so a later call can use it. A null tells the caller to do
 * its own ids read, so a cold memo never adds latency.
 *
 * Equivalent to ids mode for any id set: both apply the same publication
 * gates (visible, official_url, source_checked_at, image_url, active source,
 * approved brand, test brands excluded) and `isCatalogEligible`, with no
 * category restriction.
 */
export function peekCatalogSnapshot(): Map<string, CatalogProduct> | null {
  const entry = loadMemoEntry(SNAPSHOT_FILTERS);
  if (!entry.settled) return null;
  entry.byId ??= new Map(entry.settled.map((p) => [p.id, p]));
  return entry.byId;
}

/** Brand round-robin with an independent L2 rotation inside each brand. */
export function interleaveCatalogProducts(
  products: readonly CatalogProduct[],
): CatalogProduct[] {
  const ontologyOrder = new Map(
    L2_SUBCATEGORIES.map((node, index) => [node.slug, index]),
  );
  const byBrand = new Map<string, CatalogProduct[]>();
  for (const product of products) {
    const queue = byBrand.get(product.brandSlug) ?? [];
    queue.push(product);
    byBrand.set(product.brandSlug, queue);
  }
  const brands = [...byBrand.entries()]
    .map(([slug, rows]) => {
      const grouped = new Map<string, CatalogProduct[]>();
      for (const row of rows) {
        const queue = grouped.get(row.subcategory) ?? [];
        queue.push(row);
        grouped.set(row.subcategory, queue);
      }
      for (const queue of grouped.values()) {
        queue.sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            left.id.localeCompare(right.id),
        );
      }
      return {
        slug,
        newest:
          [...rows].sort(
            (left, right) =>
              right.createdAt.localeCompare(left.createdAt) ||
              left.id.localeCompare(right.id),
          )[0]?.createdAt ?? "",
        queues: [...grouped.entries()]
          .map(([subcategory, queue]) => ({ subcategory, queue: [...queue] }))
          .sort(
            (left, right) =>
              (right.queue[0]?.createdAt ?? "").localeCompare(
                left.queue[0]?.createdAt ?? "",
              ) ||
              (ontologyOrder.get(left.subcategory) ?? Number.MAX_SAFE_INTEGER) -
                (ontologyOrder.get(right.subcategory) ??
                  Number.MAX_SAFE_INTEGER),
          ),
        cursor: 0,
      };
    })
    .sort(
      (left, right) =>
        right.newest.localeCompare(left.newest) ||
        left.slug.localeCompare(right.slug),
    );

  const ordered: CatalogProduct[] = [];
  let remaining = products.length;
  while (remaining > 0) {
    for (const brand of brands) {
      if (brand.queues.length === 0) continue;
      let attempts = 0;
      while (attempts < brand.queues.length) {
        const index = brand.cursor % brand.queues.length;
        const product = brand.queues[index]?.queue.shift();
        brand.cursor = (index + 1) % brand.queues.length;
        attempts += 1;
        if (!product) continue;
        ordered.push(product);
        remaining -= 1;
        break;
      }
    }
  }
  return ordered;
}

// ---------------------------------------------------------------------------
// Facet counts — powers the filter sidebar
// ---------------------------------------------------------------------------

export type FacetCounts = {
  categoryCounts: { slug: string; count: number }[];
  subcategoryCounts: { slug: string; count: number }[];
  materialCounts: { slug: string; count: number }[];
};

type ProductFacetRow = {
  category: string | null;
  subcategory: string | null;
  material: string[] | null;
  image_url: string | null;
};

/**
 * Counts what the catalog list renders. A photo-less row is skipped here for
 * the same reason the list drops it (DEV-1962), so a facet never promises a
 * product the grid then hides.
 */
export function aggregateProductFacetRows(
  rows: readonly ProductFacetRow[],
): FacetCounts {
  const catCounts = new Map<string, number>();
  const subCounts = new Map<string, number>();
  const matCounts = new Map<string, number>();
  for (const row of rows) {
    if (!hasRenderableCuratedImage(row.image_url)) continue;
    if (row.category) {
      catCounts.set(row.category, (catCounts.get(row.category) ?? 0) + 1);
    }
    if (row.subcategory) {
      subCounts.set(row.subcategory, (subCounts.get(row.subcategory) ?? 0) + 1);
    }
    for (const material of row.material ?? []) {
      matCounts.set(material, (matCounts.get(material) ?? 0) + 1);
    }
  }
  return {
    categoryCounts: [...catCounts.entries()]
      .map(([slug, count]) => ({ slug, count }))
      .sort((a, b) => b.count - a.count),
    subcategoryCounts: [...subCounts.entries()]
      .map(([slug, count]) => ({ slug, count }))
      .sort((a, b) => b.count - a.count),
    materialCounts: [...matCounts.entries()]
      .map(([slug, count]) => ({ slug, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function getProductFacetCounts(
  category: string | null,
): Promise<FacetCounts> {
  return getCachedProductFacetCounts(category ?? "all");
}

const getCachedProductFacetCounts = unstable_cache(
  async (categoryKey: string): Promise<FacetCounts> => {
    const category = categoryKey === "all" ? null : categoryKey;
    const supabase: Pick<SupabaseClient, "from"> =
      createServiceClient() as unknown as Pick<SupabaseClient, "from">;

    // Corpus is small (~60 per category), so client-side aggregation is fine.
    // PostgREST does not support unnest + group-by.
    const rows: ProductFacetRow[] = [];
    for (let range = 0; range < CATALOG_MAX_RANGES; range += 1) {
      const from = range * CATALOG_RANGE_SIZE;
      let query = supabase
        .from("curated_products")
        .select(
          "category, subcategory, material, image_url, curated_product_sources!inner(id), brands!inner(slug, name, status)",
        )
        .eq("visible", true)
        .not("official_url", "is", null)
        .not("source_checked_at", "is", null)
        .not("image_url", "is", null)
        .eq("curated_product_sources.state", "active")
        .eq("brands.status", "approved");
      if (category) query = query.eq("category", category);
      const filtered = excludeTestBrands(
        query as unknown as CatalogFilterQuery,
        "brands.name",
      ) as unknown as typeof query;
      const { data, error } = await filtered.range(
        from,
        from + CATALOG_RANGE_SIZE - 1,
      );
      if (error) throw error;
      const pageRows = (data ?? []) as unknown as typeof rows;
      rows.push(...pageRows);
      if (pageRows.length < CATALOG_RANGE_SIZE) break;
    }

    return aggregateProductFacetRows(rows);
  },
  ["discover-facets-v2"],
  { revalidate: 3600 },
);
