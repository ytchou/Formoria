import { unstable_cache } from "next/cache";
import { PUBLIC_DETAIL_CACHE_OPTIONS } from "@/lib/cache/public-brand-cache";
import { toPublicBrandCard } from "@/lib/brands/contracts";
import {
  getPublicBrandDetailBaseBySlug,
  getPublicBrandFaqContextById,
} from "@/lib/services/brands";
import { getBrandImages, toImageFields } from "@/lib/services/brand-images";
import { createServiceClient } from "@/lib/supabase/service";
import { getBrandFaqEntries } from "@/lib/services/brand-faq";
import { getStockistsForBrand } from "@/lib/services/stockists";
import { getRelatedBrandsByCentroid } from "@/lib/services/brand-embeddings";
import { getPublishedCuratedProductsForTrail } from "@/lib/services/curated-products";

const getCachedPublicBrandDetailBaseBySlug = unstable_cache(
  getPublicBrandDetailBaseBySlug,
  ["public-brand-detail-base-v1"],
  PUBLIC_DETAIL_CACHE_OPTIONS,
);

// Same options, so the same tag: every write that purges the base
// (`revalidatePublicBrands`) purges the gallery with it, and the gallery is
// never staler than the brand row it renders beside.
const getCachedBrandImages = unstable_cache(
  async (brandId: string) => getBrandImages(createServiceClient(), brandId),
  ["public-brand-images-v1"],
  PUBLIC_DETAIL_CACHE_OPTIONS,
);

export async function getCachedPublicBrandDetailBySlug(slug: string) {
  const detail = await getCachedPublicBrandDetailBaseBySlug(slug);
  // Keyed by id, which only the base knows, so the two reads stay sequential;
  // both are cache hits on a warm page.
  const images = await getCachedBrandImages(detail.id);
  return images.length === 0 ? detail : { ...detail, ...toImageFields(images) };
}

export const getCachedPublicBrandFacts = unstable_cache(
  async (brandId: string, categorySlug: string | null, slug: string) => {
    const [faqContext, faqEntries, stockists, related] = await Promise.all([
      getPublicBrandFaqContextById(brandId),
      getBrandFaqEntries(brandId),
      getStockistsForBrand(brandId),
      categorySlug
        ? getRelatedBrandsByCentroid(brandId, categorySlug, slug, 4)
        : Promise.resolve({ brands: [], totalCount: 0 }),
    ]);
    return {
      faqContext,
      faqEntries,
      stockists,
      relatedBrands: related.brands.map(toPublicBrandCard),
      categoryCount: related.totalCount,
    };
  },
  ["public-brand-facts-v1"],
  PUBLIC_DETAIL_CACHE_OPTIONS,
);

export const getCachedEditorialTrailProducts = unstable_cache(
  // Frontmatter contributes to the key because the service orders by authored sections.
  async (slug: string, _frontmatterVersion: string) =>
    getPublishedCuratedProductsForTrail(slug),
  ["public-editorial-trail-products-v1"],
  PUBLIC_DETAIL_CACHE_OPTIONS,
);
