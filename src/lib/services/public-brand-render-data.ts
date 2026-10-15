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
import {
  getPublishedCuratedProductsForTrail,
  getPublishedProductPreviewsForBrands,
  type BrandProductPreview,
} from "@/lib/services/curated-products";
import { captureReadFailure } from "@/lib/degraded-render";

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
    const relatedBrands = related.brands.map(toPublicBrandCard);
    // The related cards lead with the brands' products (BD-09). A plain
    // object, not the service's Map: unstable_cache JSON-serializes its
    // result. A failed read shows the cards without a product strip.
    const previewMap =
      (await getPublishedProductPreviewsForBrands(
        relatedBrands.map((brand) => brand.id),
      ).catch(captureReadFailure("brand.relatedProductPreviews"))) ??
      new Map<string, BrandProductPreview>();
    return {
      faqContext,
      faqEntries,
      stockists,
      relatedBrands,
      relatedPreviews: Object.fromEntries(previewMap) as Record<
        string,
        BrandProductPreview
      >,
      categoryCount: related.totalCount,
    };
  },
  ["public-brand-facts-v2"],
  PUBLIC_DETAIL_CACHE_OPTIONS,
);

export const getCachedEditorialTrailProducts = unstable_cache(
  // Frontmatter contributes to the key because the service orders by authored sections.
  async (slug: string, _frontmatterVersion: string) =>
    getPublishedCuratedProductsForTrail(slug),
  ["public-editorial-trail-products-v1"],
  PUBLIC_DETAIL_CACHE_OPTIONS,
);
