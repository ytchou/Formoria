import {
  ProductCardCaption,
  ProductCardFrame,
} from "@/components/products/product-card-frame";
import { Typography } from "@/components/ui/typography";
import type { AppLocale } from "@/i18n/locale-preference";
import { cn } from "@/lib/utils";
import { OriginBadge } from "./origin-badge";
import {
  tileFields,
  type SelectedProductTileLabels,
  type SelectedProductTileProduct,
} from "./tile-fields";

export type OutboundTileProps = {
  locale: AppLocale;
  product: SelectedProductTileProduct;
  labels: SelectedProductTileLabels;
  imageSizes?: string;
  className?: string;
};

/**
 * The inert brand-page variant: photo, name, the one description block and
 * the unavailable note. No links, no trust label, no brand line.
 */
export function OutboundTile({
  locale,
  product,
  labels,
  imageSizes,
  className,
}: OutboundTileProps) {
  const { name, nameLang, description, descriptionLang, imageSrc, isBroken } =
    tileFields(product, locale, labels);
  return (
    <li
      id={`product-${product.key}`}
      className={cn("flex list-none flex-col", className)}
    >
      <ProductCardFrame
        src={imageSrc}
        name={name}
        category={product.category}
        surface="tile"
        sizes={imageSizes}
        badge={
          <OriginBadge
            mitQualified={product.mitQualified}
            label={labels.madeInTaiwan}
          />
        }
      />
      <ProductCardCaption name={name} nameLang={nameLang}>
        {description ? (
          <Typography as="p" variant="body" lang={descriptionLang}>
            {description}
          </Typography>
        ) : null}
        {isBroken ? (
          <Typography as="p" variant="metadata">
            {labels.unavailable}
          </Typography>
        ) : null}
      </ProductCardCaption>
    </li>
  );
}
