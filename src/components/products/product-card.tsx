import { Link } from "@/i18n/navigation";
import { SurfaceImage } from "@/components/ui/image";
import { BrandImageFallback } from "@/components/brands/brand-image-fallback";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { routes } from "@/lib/routes";
import { NO_SNIPPET } from "@/lib/seo/snippet";
import type { CatalogProduct } from "@/lib/services/curated-products-catalog";

/** Tile widths at the `catalog` grid stops — /discover's results column. */
const CATALOG_IMAGE_SIZES =
  "(min-width: 1536px) 240px, (min-width: 1280px) 220px, (min-width: 768px) 33vw, 50vw";

type ProductCardProps = {
  product: CatalogProduct;
  locale: string;
  /** `sizes` for the photo; a caller on a different grid states its own. */
  imageSizes?: string;
  /**
   * Above-the-fold loading. "high" = eager + fetchPriority high (the LCP
   * candidate); "eager" = eager only; omitted = next/image's lazy default.
   * The caller owns the grid geometry, so it decides which cards qualify.
   */
  imagePriority?: "high" | "eager";
};

/** Marks zh text shown on an EN page through the locale fallback. */
const ZH_FALLBACK_LANG = "zh-Hant-TW";

export function ProductCard({
  product,
  locale,
  imageSizes = CATALOG_IMAGE_SIZES,
  imagePriority,
}: ProductCardProps) {
  const isEnglish = locale === "en";
  const nameFallsBack = isEnglish && !product.nameEn;
  const name = isEnglish && product.nameEn ? product.nameEn : product.nameZh;
  const descriptionFallsBack = isEnglish && !product.productDescriptionEn;
  const description =
    isEnglish && product.productDescriptionEn
      ? product.productDescriptionEn
      : product.productDescriptionZh;
  const imageSrc = safeImageSrc(product.imageUrl);

  return (
    <li data-brand-slug={product.brandSlug} data-product-key={product.key}>
      <Link
        href={routes.brand(product.brandSlug)}
        className="group flex h-full flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-3"
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-surface bg-surface-deep">
          {imageSrc ? (
            <SurfaceImage
              src={imageSrc}
              alt={name}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:duration-[0.01ms]"
              surface="card"
              sizes={imageSizes}
              loading={imagePriority ? "eager" : undefined}
              fetchPriority={imagePriority === "high" ? "high" : undefined}
            />
          ) : (
            <BrandImageFallback
              name={name}
              category={product.category}
              size="card"
            />
          )}
          {/* Product saving was removed (DEV-1988 owner decision); its app-side
              save path was deleted and must be rebuilt when requested. */}
        </div>

        <div className="mt-3 flex flex-col gap-1">
          <p className="type-body-sm text-ink-muted truncate">
            {product.brandName}
          </p>
          <h3
            lang={nameFallsBack ? ZH_FALLBACK_LANG : undefined}
            className="type-body font-semibold text-ink line-clamp-2 group-hover:underline"
          >
            {name}
          </h3>
          <p
            {...NO_SNIPPET}
            lang={descriptionFallsBack ? ZH_FALLBACK_LANG : undefined}
            // max-sm:hidden, not `hidden sm:block`: sm:block would replace
            // line-clamp's -webkit-box display and drop the 1-line clamp.
            className="type-body-sm text-ink-muted line-clamp-1 max-sm:hidden"
          >
            {description}
          </p>
        </div>
      </Link>
    </li>
  );
}
