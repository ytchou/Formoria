import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { SurfaceImage } from "@/components/ui/image";
import { Typography } from "@/components/ui/typography";
import { surfaceCardStyles } from "@/components/ui/card";
import { BrandImageFallback } from "@/components/brands/brand-image-fallback";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { routes } from "@/lib/routes";
import type { CatalogProduct } from "@/lib/services/curated-products-catalog";
import { subcategoryBySlug, subcategoryLabel } from "@/lib/taxonomy/ontology";
import { SaveButton } from "@/components/ui/save-button";

type ProductCardProps = {
  product: CatalogProduct;
  locale: string;
};

export function ProductCard({ product, locale }: ProductCardProps) {
  const isEnglish = locale === "en";
  const name = (isEnglish ? product.nameEn : product.nameZh) ?? product.nameZh;
  const imageSrc = safeImageSrc(product.imageUrl);
  const subcategory = subcategoryBySlug(product.subcategory);
  const subcategoryName = subcategory
    ? subcategoryLabel(subcategory, locale)
    : product.subcategory;

  return (
    <li
      className={surfaceCardStyles({
        padding: "none",
        className: "flex flex-col overflow-hidden",
      })}
    >
      <Link
        href={routes.brand(product.brandSlug)}
        className="group flex h-full flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-3"
      >
        <div className="relative aspect-square w-full overflow-hidden bg-surface-deep">
          {imageSrc ? (
            <SurfaceImage
              src={imageSrc}
              alt={name}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:duration-[0.01ms]"
              surface="card"
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

        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <Typography
            as="h3"
            variant="cardTitle"
            className="group-hover:text-accent"
          >
            {name}
          </Typography>
          <Typography as="p" variant="metadata">
            {product.brandName}
          </Typography>
          <Badge variant="declared" className="mt-auto self-start">
            {subcategoryName}
          </Badge>
        </div>
      </Link>
    </li>
  );
}
