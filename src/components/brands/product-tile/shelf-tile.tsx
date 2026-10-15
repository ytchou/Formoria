import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

import {
  ProductCardCaption,
  ProductCardFrame,
} from "@/components/products/product-card-frame";
import { textStyles } from "@/components/ui/text-styles";
import { TrustLabel } from "@/components/ui/trust-label";
import { Typography } from "@/components/ui/typography";
import type { AppLocale } from "@/i18n/locale-preference";
import { Link } from "@/i18n/navigation";
import { routes } from "@/lib/routes";
import { contentLangFor } from "@/lib/trails/content-lang";
import { cn } from "@/lib/utils";
import { SelectedProductExternalLink } from "../selected-product-external-link";
import { OriginBadge } from "./origin-badge";
import { NAME_LINK_HIT_AREA } from "./trail-product-tile";
import {
  tileFields,
  type SelectedProductTileLabels,
  type SelectedProductTileProduct,
  type TileBrand,
} from "./tile-fields";

/** The published trail (guide) that placed a shelf product. */
export type SelectedProductTileGuide = {
  slug: string;
  title: string;
  /** The trail's frontmatter locale, for the title's `lang`. */
  locale: string;
};

export type ShelfTileProps = {
  locale: AppLocale;
  product: SelectedProductTileProduct;
  labels: SelectedProductTileLabels;
  brand?: TileBrand;
  className?: string;
  /**
   * The guide that placed this product. Its presence is the reason a
   * Formoria-selection label may render (CP2-15); without it the tile shows none.
   */
  guide?: SelectedProductTileGuide;
  /**
   * Called when the photo fails to load, so the client shelf can drop the
   * tile. The tile itself stays hook-free (it is isomorphic).
   */
  onImageError?: () => void;
};

/**
 * A brand-page shelf tile is one honest link (DEV-1994): image and name
 * together go out to the product's own page — the brand site when the product
 * link is broken — never internally. No brand line: this is the brand's own
 * page. The click is tracked as a `selected_product` external link (BD-02).
 */
export function ShelfTile({
  locale,
  product,
  labels,
  brand,
  className,
  guide,
  onImageError,
}: ShelfTileProps) {
  const {
    name,
    nameBreaks,
    nameLang,
    description,
    descriptionLang,
    imageSrc,
    isBroken,
    chip,
  } = tileFields(product, locale, labels, brand);
  // Render-side guard: a Formoria-selection shelf tile never draws a letter
  // placeholder. The data-side publish precondition (no photo, no publish) is
  // a separate ticket.
  if (!imageSrc) return null;

  const media = (
    <>
      <ProductCardFrame
        src={imageSrc}
        name={name}
        category={product.category}
        sizes="(max-width: 640px) 80vw, (max-width: 1024px) 45vw, (max-width: 1600px) 23vw, 368px"
        onError={onImageError}
        badge={
          <OriginBadge
            mitQualified={product.mitQualified}
            label={labels.madeInTaiwan}
          />
        }
      />
      <ProductCardCaption
        name={name}
        nameBreaks={nameBreaks}
        nameLang={nameLang}
        // Two lines, always: a one-line name still reserves the second line so
        // the descriptions in a row start on one baseline.
        nameClassName="min-h-[2lh] min-w-0 flex-1"
        renderName={(heading: ReactNode) => (
          <div className="flex items-start gap-1">
            {heading}
            {chip.href ? (
              <ArrowUpRight
                aria-hidden
                className="mt-1 size-4 shrink-0 text-ink-muted group-hover:text-accent"
              />
            ) : null}
          </div>
        )}
      />
      {chip.href ? <span className="sr-only">{chip.label}</span> : null}
    </>
  );

  return (
    <li
      id={`product-${product.key}`}
      // Trail deep links land here; clear the sticky header and, below `md`,
      // the section strip — the brand page's section offsets.
      className={cn(
        "relative list-none scroll-mt-40 md:scroll-mt-28",
        className,
      )}
    >
      <div className="relative flex h-full flex-col">
        {chip.href && brand ? (
          <SelectedProductExternalLink
            href={chip.href}
            brandSlug={brand.slug}
            linkType={chip.linkType}
            referrerPage={routes.brand(brand.slug)}
            surface="selected_product"
            brandId={brand.id}
            productKey={product.key}
            className="group flex flex-col rounded-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-3"
          >
            {media}
          </SelectedProductExternalLink>
        ) : (
          <div className="flex flex-col">{media}</div>
        )}
        {/* Product saving was removed (DEV-1988 owner decision): no page
            listed saved products. The app-side save path (hook, action,
            service, messages) was deleted and must be rebuilt when requested;
            the saved_products table still holds its data. Render the save
            control as a sibling of the link here, never inside it. */}
        {description ? (
          <p
            className="mt-1 type-body-sm text-ink-muted line-clamp-2"
            lang={descriptionLang}
          >
            {description}
          </p>
        ) : null}
        {/* Formoria-selection only with its reason (CP2-15): the guide that placed it. */}
        {guide ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <TrustLabel />
            <Link
              href={routes.trail(guide.slug)}
              className={cn(
                NAME_LINK_HIT_AREA,
                textStyles({ variant: "link" }),
              )}
            >
              {labels.inGuide ? (
                <span className="sr-only">{`${labels.inGuide} `}</span>
              ) : null}
              <span lang={contentLangFor(guide.locale, locale)}>
                {guide.title}
              </span>
            </Link>
          </div>
        ) : null}
        {isBroken ? (
          <Typography as="p" variant="metadata" className="mt-2">
            {labels.unavailable}
          </Typography>
        ) : null}
      </div>
    </li>
  );
}
