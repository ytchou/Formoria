import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

import {
  ProductCardCaption,
  ProductCardFrame,
} from "@/components/products/product-card-frame";
import { Typography } from "@/components/ui/typography";
import type { AppLocale } from "@/i18n/locale-preference";
import { Link } from "@/i18n/navigation";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { SelectedProductExternalLink } from "../selected-product-external-link";
import { SelectedProductTileLink } from "../selected-product-tile-link";
import { OriginBadge } from "./origin-badge";
import {
  tileFields,
  type SelectedProductTileLabels,
  type SelectedProductTileProduct,
  type TileBrand,
} from "./tile-fields";

// DESIGN.md §7: a 44px-tall centered `::after` overlay (`min-h-11`) grows a
// text link's hit area without resizing its text (DS-39).
export const NAME_LINK_HIT_AREA =
  "relative rounded-control after:absolute after:inset-x-0 after:top-1/2 after:h-full after:min-h-11 after:-translate-y-1/2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export type TrailProductTileProps = {
  locale: AppLocale;
  product: SelectedProductTileProduct;
  labels: SelectedProductTileLabels;
  /** This pick's editorial note (D13), authored in the trail's frontmatter. */
  note?: string;
  imageSizes?: string;
  className?: string;
  brand?: TileBrand;
  brandSlug?: string;
  brandName?: string;
  /** Click tracking for the brand-page route and the outbound name link. */
  tracking?: {
    brandSlug: string;
    position: number;
    surface: string;
    referrerPage?: string;
    brandId?: string;
  };
};

/**
 * Trail route treatment (R2-12, the shelf's since DEV-1994): the name is the
 * outbound link with a ↗, so eleven tiles no longer repeat one pill. The brand
 * line keeps the route to the brand page's `#product-` anchor — from a trail
 * the reader already has the context and is asking for one specific item.
 * With no outbound href the name keeps that internal route instead. The image
 * stays unlinked.
 *
 * Unframed since DS-04: photo and caption, the grammar of every other card.
 * Phones step the name down to body size, three lines (R2-03): the trail grid
 * is two-up there, and a 21px title in a ~100px column split Latin words and
 * ran five lines.
 */
export function TrailProductTile({
  locale,
  product,
  labels,
  note,
  imageSizes,
  className,
  brand,
  brandSlug,
  brandName,
  tracking,
}: TrailProductTileProps) {
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
  const internalHref = `${routes.brand(brandSlug ?? brand?.slug ?? "")}#product-${product.key}`;
  const internalLinkClassName = cn(NAME_LINK_HIT_AREA, "group");
  const outboundLinkClassName = cn(
    NAME_LINK_HIT_AREA,
    "group flex items-start gap-1",
  );

  const renderName = (heading: ReactNode) => {
    const outboundContent = (
      <>
        {heading}
        <ArrowUpRight
          aria-hidden
          className="mt-1 size-4 shrink-0 text-ink-muted group-hover:text-accent"
        />
        <span className="sr-only">{` ${chip.label}`}</span>
      </>
    );
    if (chip.href) {
      return tracking && brand ? (
        <SelectedProductExternalLink
          href={chip.href}
          brandSlug={brand.slug}
          linkType={chip.linkType}
          referrerPage={tracking.referrerPage ?? routes.discover()}
          surface={tracking.surface as `trail:${string}:${string}`}
          brandId={tracking.brandId}
          productKey={product.key}
          className={outboundLinkClassName}
        >
          {outboundContent}
        </SelectedProductExternalLink>
      ) : (
        <a
          href={chip.href}
          target="_blank"
          rel="noopener noreferrer"
          className={outboundLinkClassName}
          data-brand-slug={brand?.slug}
          data-link-type={chip.linkType}
          data-link-surface="selected_product"
        >
          {outboundContent}
        </a>
      );
    }
    return tracking ? (
      <SelectedProductTileLink
        href={internalHref}
        className={internalLinkClassName}
        productKey={product.key}
        brandSlug={tracking.brandSlug}
        position={tracking.position}
        surface={tracking.surface}
      >
        {heading}
      </SelectedProductTileLink>
    ) : (
      <Link
        href={internalHref}
        className={internalLinkClassName}
        data-ph-no-autocapture
      >
        {heading}
      </Link>
    );
  };

  // With an outbound name, the brand line carries the brand-page route; without
  // one the name already does, so the brand line stays plain text.
  const brandLinkClassName = cn(
    NAME_LINK_HIT_AREA,
    "type-body-sm text-ink-muted hover:text-accent",
  );
  const brandLine =
    brandName && chip.href ? (
      tracking ? (
        <SelectedProductTileLink
          href={internalHref}
          className={brandLinkClassName}
          productKey={product.key}
          brandSlug={tracking.brandSlug}
          position={tracking.position}
          surface={tracking.surface}
        >
          {brandName}
        </SelectedProductTileLink>
      ) : (
        <Link
          href={internalHref}
          className={brandLinkClassName}
          data-ph-no-autocapture
        >
          {brandName}
        </Link>
      )
    ) : (
      brandName
    );

  return (
    <li
      id={`product-${product.key}`}
      className={cn("flex list-none flex-col", className)}
    >
      <ProductCardFrame
        src={imageSrc}
        name={name}
        category={product.category}
        surface="trailTile"
        sizes={imageSizes}
        badge={
          <OriginBadge
            mitQualified={product.mitQualified}
            label={labels.madeInTaiwan}
          />
        }
      />
      <ProductCardCaption
        brand={brandLine}
        name={name}
        nameBreaks={nameBreaks}
        nameLang={nameLang}
        nameClassName="min-w-0 flex-1 max-sm:line-clamp-3"
        renderName={renderName}
      >
        {/* The note is content, so Ming at body size. */}
        {note ? <p className="type-body line-clamp-2">{note}</p> : null}
        {description ? (
          // Under a note the description is supporting detail: small, muted,
          // two lines, and dropped on phones where the note carries the pick.
          // With no note it is the only text, so it shows at every width.
          <p
            // `max-sm:hidden`, never `hidden sm:block`: `sm:block` overrides
            // the `-webkit-box` display `line-clamp` needs (DS-25).
            className={cn(
              "type-body-sm text-ink-muted line-clamp-2",
              note && "max-sm:hidden",
            )}
            lang={descriptionLang}
          >
            {description}
          </p>
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
