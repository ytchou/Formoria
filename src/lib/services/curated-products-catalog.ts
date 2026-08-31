import type { SupabaseClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { excludeTestBrands } from "@/lib/services/public-brand-filter";
import type { BrandVisitLinkFields } from "@/lib/brands/link-fallback";
import { L2_SUBCATEGORIES, subcategoryBySlug } from "@/lib/taxonomy/ontology";

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
  image_url, official_url, material,
  curated_product_sources!inner(id),
  brands!inner(slug, name, status, purchase_website, purchase_pinkoi, purchase_shopee, purchase_myship, social_instagram, social_threads, social_facebook)
`;

const DEFAULT_PAGE_SIZE = 12;
const CATALOG_RANGE_SIZE = 500;
const CATALOG_MAX_RANGES = 200;

export type CatalogQueryOptions = {
  category?: string | null;
  subcategories?: string[];
  materials?: string[];
  sort?: "newest" | "alphabetical";
  page?: number;
  pageSize?: number;
};

type CatalogFilterQuery = {
  not(column: string, operator: string, value: string): CatalogFilterQuery;
};

/**
 * Published curated products for the /discover catalog, with optional category
 * filtering and pagination. Shares the publication/evidence gates of the
 * homepage read: visible, has official_url, source_checked_at, at least one
 * active source and approved brand. Products without mirrored images remain
 * eligible.
 */
export async function getPublishedCuratedProducts(
  options: CatalogQueryOptions = {},
  client?: Pick<SupabaseClient, "from">,
): Promise<{ products: CatalogProduct[]; totalCount: number }> {
  const {
    category,
    subcategories,
    materials,
    sort = "newest",
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  } = options;
  const supabase: Pick<SupabaseClient, "from"> =
    client ??
    (createServiceClient() as unknown as Pick<SupabaseClient, "from">);

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
        .eq("curated_product_sources.state", "active")
        .eq("brands.status", "approved");
      if (category) query = query.eq("category", category);
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
    .filter((row) => canonicalCatalogSubcategory(row) !== null)
    .map(transformCatalogRow);
  const ordered =
    sort === "alphabetical"
      ? allProducts
      : interleaveCatalogProducts(allProducts);
  const offset = (page - 1) * pageSize;
  return {
    products: ordered.slice(offset, offset + pageSize),
    totalCount: ordered.length,
  };
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
  subcategoryCounts: { slug: string; count: number }[];
  materialCounts: { slug: string; count: number }[];
};

type ProductFacetRow = {
  subcategory: string | null;
  material: string[] | null;
};

export function aggregateProductFacetRows(
  rows: readonly ProductFacetRow[],
): FacetCounts {
  const subCounts = new Map<string, number>();
  const matCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.subcategory) {
      subCounts.set(row.subcategory, (subCounts.get(row.subcategory) ?? 0) + 1);
    }
    for (const material of row.material ?? []) {
      matCounts.set(material, (matCounts.get(material) ?? 0) + 1);
    }
  }
  return {
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
          "subcategory, material, curated_product_sources!inner(id), brands!inner(slug, name, status)",
        )
        .eq("visible", true)
        .not("official_url", "is", null)
        .not("source_checked_at", "is", null)
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
  ["discover-facets-v1"],
  { revalidate: 3600 },
);
