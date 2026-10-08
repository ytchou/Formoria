import type { SelectedProductTileProduct } from "@/components/brands/selected-product-tile";
import type { BrandVisitLinkFields } from "@/lib/brands/link-fallback";
import type { HomepageCuratedProduct } from "@/lib/services/curated-products";

/**
 * What one homepage band tile needs, and nothing more: the tile's own product
 * fields plus the brand fields `CuratedProductGrid` passes it.
 *
 * A client-fetched category group (DEV-1972) ships this as JSON, so every field
 * here is paid for on every chip click. Audit fields, the image's source URL and
 * its measured size never reach the browser; the grid renders every tile at
 * 1:1, so the ratio is not carried either.
 *
 * Leaf module: type-only imports, safe for client and server alike.
 */
export type WallTileProduct = SelectedProductTileProduct & {
  brandSlug: string;
  brandName: string;
  brand: BrandVisitLinkFields & { slug: string };
};

export type WallTileSlot = { product: WallTileProduct };

export function toWallTileProduct(
  product: HomepageCuratedProduct,
): WallTileProduct {
  return {
    id: product.id,
    key: product.key,
    nameZh: product.nameZh,
    nameEn: product.nameEn,
    productDescriptionZh: product.productDescriptionZh,
    productDescriptionEn: product.productDescriptionEn,
    imageUrl: product.imageUrl,
    subcategory: product.subcategory,
    category: product.category,
    linkState: product.linkState,
    officialUrl: product.officialUrl,
    mitQualified: product.mitQualified,
    brandSlug: product.brandSlug,
    brandName: product.brandName,
    brand: {
      slug: product.brand.slug,
      purchaseWebsite: product.brand.purchaseWebsite,
      purchasePinkoi: product.brand.purchasePinkoi,
      purchaseShopee: product.brand.purchaseShopee,
      purchaseMyship: product.brand.purchaseMyship,
      socialInstagram: product.brand.socialInstagram,
      socialThreads: product.brand.socialThreads,
      socialFacebook: product.brand.socialFacebook,
    },
  };
}
