import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import {
  excludeTestBrands,
} from "@/lib/services/public-brand-filter";
import type { BrandVisitLinkFields } from "@/lib/brands/link-fallback";

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
  subcategories: string[];
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
  subcategories: string[] | null;
  image_url: string | null;
  official_url: string | null;
  brands: CatalogBrandRow | null;
};

// ---------------------------------------------------------------------------
// Transformer — exported for tests (no Supabase mock needed)
// ---------------------------------------------------------------------------

export function transformCatalogRow(row: CatalogProductRow): CatalogProduct {
  const brand = row.brands;
  if (!brand) {
    throw new Error(`Catalog product ${row.id} is missing its brand`);
  }
  return {
    id: row.id,
    key: row.key,
    nameZh: row.name_zh,
    nameEn: row.name_en ?? null,
    category: row.category,
    subcategories: row.subcategories ?? [],
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

const CATALOG_SELECT = `
  id, key, name_zh, name_en, category, subcategories,
  image_url, official_url,
  curated_product_sources!inner(id),
  brands!inner(slug, name, status, purchase_website, purchase_pinkoi, purchase_shopee, purchase_myship, social_instagram, social_threads, social_facebook)
`;

const DEFAULT_PAGE_SIZE = 12;

export type CatalogQueryOptions = {
  category?: string | null;
  subcategory?: string | null;
  page?: number;
  pageSize?: number;
};

/**
 * Published curated products for the /discover catalog, with optional category
 * filtering and pagination. Shares the publication/evidence gates of the
 * homepage read: visible, has official_url, source_checked_at, at least one
 * active source, approved brand, non-null image.
 */
export async function getPublishedCuratedProducts(
  options: CatalogQueryOptions = {},
): Promise<{ products: CatalogProduct[]; totalCount: number }> {
  const {
    category,
    subcategory,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  } = options;
  const offset = (page - 1) * pageSize;

  const supabase: Pick<SupabaseClient, "from"> =
    createServiceClient() as unknown as Pick<SupabaseClient, "from">;

  let query = supabase
    .from("curated_products")
    .select(CATALOG_SELECT, { count: "exact", head: false })
    .eq("visible", true)
    .not("official_url", "is", null)
    .not("source_checked_at", "is", null)
    .eq("curated_product_sources.state", "active")
    .eq("brands.status", "approved");

  if (category) {
    query = query.eq("category", category);
  }
  if (subcategory) {
    query = query.contains("subcategories", [subcategory]);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder generic depth exceeds TS limit (TS2589)
  const filtered = excludeTestBrands(query as any, "brands.name") as typeof query;
  const final = filtered.order("created_at", { ascending: false }).range(offset, offset + pageSize - 1);

  const { data, count, error } = await final;
  if (error) throw error;

  const products = ((data ?? []) as unknown as CatalogProductRow[])
    .map(transformCatalogRow);

  return { products, totalCount: count ?? 0 };
}
