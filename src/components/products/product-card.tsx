import { Link } from "@/i18n/navigation";
import { SurfaceImage } from "@/components/ui/image";
import { BrandImageFallback } from "@/components/brands/brand-image-fallback";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { routes } from "@/lib/routes";
import { NO_SNIPPET } from "@/lib/seo/snippet";
import type { CatalogProduct } from "@/lib/services/curated-products-catalog";
import { SaveButton } from "@/components/ui/save-button";

/** Tile widths at the `catalog` grid stops — /discover's results column. */
const CATALOG_IMAGE_SIZES =
  "(min-width: 1536px) 240px, (min-width: 1280px) 220px, (min-width: 768px) 33vw, 50vw";

type ProductCardProps = {
  product: CatalogProduct;
  locale: string;
  /** `sizes` for the photo; a caller on a different grid states its own. */
  imageSizes?: string;
};

export function ProductCard({
  product,
  locale,
  imageSizes = CATALOG_IMAGE_SIZES,
}: ProductCardProps) {
  const isEnglish = locale === "en";
  const name = (isEnglish ? product.nameEn : product.nameZh) ?? product.nameZh;
  const description = isEnglish
    ? (product.productDescriptionEn ?? product.productDescriptionZh)
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
            />
          ) : (
            <BrandImageFallback
              name={name}
              category={product.category}
              size="card"
            />
          )}
          <SaveButton
            kind="product"
            id={product.id}
            slug={product.key}
            variant="overlay"
          />
        </div>

        <div className="mt-3 flex flex-col gap-1">
          <p className="type-metadata text-accent truncate">
            {product.brandName}
          </p>
          <h3 className="type-body font-semibold text-ink line-clamp-1 group-hover:underline">
            {name}
          </h3>
          <p
            {...NO_SNIPPET}
            className="type-body-sm text-ink-muted line-clamp-1"
          >
            {description}
          </p>
        </div>
      </Link>
    </li>
  );
}
