import { Link } from "@/i18n/navigation";
import { SurfaceImage } from "@/components/ui/image";
import { Typography } from "@/components/ui/typography";
import { surfaceCardStyles } from "@/components/ui/card";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import { routes } from "@/lib/routes";
import type { CatalogProduct } from "@/lib/services/curated-products-catalog";
import { categoryLabel, L1_CATEGORIES } from "@/lib/taxonomy/ontology";
import { cn } from "@/lib/utils";

type ProductCardProps = {
  product: CatalogProduct;
  locale: string;
};

export function ProductCard({ product, locale }: ProductCardProps) {
  const isEnglish = locale === "en";
  const name =
    (isEnglish ? product.nameEn : product.nameZh) ?? product.nameZh;
  const imageSrc = safeImageSrc(product.imageUrl);
  const category = L1_CATEGORIES.find((c) => c.slug === product.category);
  const categoryName = category
    ? categoryLabel(category, locale)
    : product.category;

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
            <div className="flex h-full items-center justify-center bg-surface text-ink-muted">
              <span className="type-body-sm">{name}</span>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <Typography as="h3" variant="cardTitle" className="group-hover:text-accent">
            {name}
          </Typography>
          <Typography as="p" variant="metadata">
            {product.brandName}
          </Typography>
          <span
            className={cn(
              "mt-auto inline-block self-start rounded-full px-2 py-0.5",
              "type-metadata text-ink-muted",
              "border border-rule",
            )}
          >
            {categoryName}
          </span>
        </div>
      </Link>
    </li>
  );
}
