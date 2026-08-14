import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { surfaceCardStyles } from "@/components/ui/card";
import { Typography } from "@/components/ui/typography";
import type { AppLocale } from "@/i18n/locale-preference";
import {
  getBrandVisitLink,
  type BrandVisitLinkFields,
} from "@/lib/brands/link-fallback";
import { safeImageSrc } from "@/lib/images/allowed-image-hosts";
import type { CuratedProduct } from "@/lib/services/curated-products";
import { sanitizeHref } from "@/lib/url";
import { BrandImageFallback } from "./brand-image-fallback";
import { SelectedProductTileLink } from "./selected-product-tile-link";

export type SelectedProductTileLabels = {
  cta: string;
  brandSiteCta: string;
  selectedBadge: string;
  brandProvidedBadge: string;
  unavailable: string;
};

export type SelectedProductTileProps = {
  locale: AppLocale;
  product: CuratedProduct;
  labels: SelectedProductTileLabels;
  mode: "outbound" | "internal";
  /** Existing brand-page fields used by the outbound chip. */
  brand?: BrandVisitLinkFields & { slug: string };
  /** Homepage-only destination and accessible brand name. */
  brandSlug?: string;
  brandName?: string;
  /** Optional homepage click tracking; omitted for the inert brand-page variant. */
  tracking?: {
    brandSlug: string;
    position: number;
    surface: string;
  };
};

const BROKEN_LINK_STATE = "broken";
const RENDERABLE_IMAGE_USAGE = "permitted";

/**
 * The selected-product tile stays server-rendered. Outbound product chips
 * preserve the brand-page behavior; internal mode turns the whole tile into
 * one accessible link to the product anchor on that brand's page. The optional
 * client link child adds click tracking without moving the tile into the client graph.
 */
export function SelectedProductTile({
  locale,
  product,
  labels,
  mode,
  brand,
  brandSlug,
  brandName,
  tracking,
}: SelectedProductTileProps) {
  const isEnglish = locale === "en";
  const name =
    (isEnglish ? product.nameEn : product.nameZh) ?? product.nameZh;
  const reason = isEnglish
    ? (product.rationaleEn ?? product.rationaleZh)
    : product.rationaleZh;
  const fact = isEnglish
    ? (product.notesEn ?? product.notesZh)
    : product.notesZh;
  const imageSrc =
    product.imageUsage === RENDERABLE_IMAGE_USAGE
      ? safeImageSrc(product.imageUrl)
      : null;
  const isBroken = product.linkState === BROKEN_LINK_STATE;
  const visitLink = mode === "outbound" && brand ? getBrandVisitLink(brand) : null;
  const productHref = sanitizeHref(product.officialUrl);
  const chipHref = isBroken ? (visitLink?.href ?? null) : productHref;
  const chipLabel = isBroken ? labels.brandSiteCta : labels.cta;
  const chipLinkType = isBroken ? "brand_site" : "curated_product";
  const chipClassName = buttonVariants({
    variant: "secondary",
    shape: "pill",
    size: "compact",
    className: "mt-auto max-w-full justify-center",
  });
  const destinationSlug = brandSlug ?? brand?.slug ?? "";
  const internalHref = `/brands/${destinationSlug}#product-${product.key}`;
  const linkedBrandName =
    brandName ??
    (brand && "name" in brand && typeof brand.name === "string"
      ? brand.name
      : null);
  const accessibleName = [name, linkedBrandName].filter(Boolean).join(": ");
  const internalClassName =
    "group flex h-full flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-3";

  const content = (
    <>
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={name}
            fill
            className={
              mode === "internal"
                ? "object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                : "object-cover"
            }
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <BrandImageFallback
            name={name}
            category={product.l1}
            size="card"
          />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <Typography
          as="h3"
          variant="cardTitle"
          className={mode === "internal" ? "group-hover:text-primary" : undefined}
        >
          {name}
        </Typography>

        {mode === "internal" && brandName ? (
          <Typography as="p" variant="metadata">
            {brandName}
          </Typography>
        ) : null}

        {reason ? (
          <>
            <Typography as="p" variant="body">
              {reason}
            </Typography>
            <div>
              <Badge variant="secondary">{labels.selectedBadge}</Badge>
            </div>
          </>
        ) : null}

        {fact ? (
          <>
            <Typography as="p" variant="metadata">
              {fact}
            </Typography>
            <div>
              <Badge variant="declared">{labels.brandProvidedBadge}</Badge>
            </div>
          </>
        ) : null}

        {isBroken ? (
          <Typography as="p" variant="metadata">
            {labels.unavailable}
          </Typography>
        ) : null}

        {mode === "outbound" && chipHref ? (
          <a
            href={chipHref}
            target="_blank"
            rel="noopener noreferrer"
            className={chipClassName}
            data-brand-slug={brand?.slug}
            data-link-type={chipLinkType}
            data-link-surface="selected_product"
          >
            <span className="min-w-0 truncate">{chipLabel}</span>
            {isBroken ? null : (
              <span className="sr-only">
                {`: ${name}${linkedBrandName ? ` (${linkedBrandName})` : ""}`}
              </span>
            )}
          </a>
        ) : null}
      </div>
    </>
  );

  return (
    <li
      id={`product-${product.key}`}
      className={surfaceCardStyles({
        padding: "none",
        className: "flex flex-col overflow-hidden",
      })}
    >
      {mode === "internal" ? (
        tracking ? (
          <SelectedProductTileLink
            href={internalHref}
            ariaLabel={accessibleName}
            className={internalClassName}
            productKey={product.key}
            brandSlug={tracking.brandSlug}
            position={tracking.position}
            surface={tracking.surface}
          >
            {content}
          </SelectedProductTileLink>
        ) : (
          <Link
            href={internalHref}
            aria-label={accessibleName}
            className={internalClassName}
            data-ph-no-autocapture
          >
            {content}
          </Link>
        )
      ) : (
        content
      )}
    </li>
  );
}
