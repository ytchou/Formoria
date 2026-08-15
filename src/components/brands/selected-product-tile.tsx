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
import { cn } from "@/lib/utils";
import { BrandImageFallback } from "./brand-image-fallback";
import { SelectedProductTileLink } from "./selected-product-tile-link";
import { SelectedProductExternalLink } from "./selected-product-external-link";

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
  mode: "outbound" | "internal" | "trail" | "wall";
  /** Wall geometry; ignored by the existing brand and trail variants. */
  span?: "1x1" | "2x1" | "2x2";
  /** Existing brand-page fields used by the outbound chip. */
  brand?: BrandVisitLinkFields & { slug: string };
  /** Homepage-only destination and visible brand name. */
  brandSlug?: string;
  brandName?: string;
  /** Optional homepage click tracking; omitted for the inert brand-page variant. */
  tracking?: {
    brandSlug: string;
    position: number;
    surface: string;
    referrerPage?: string;
    brandId?: string;
  };
};

const BROKEN_LINK_STATE = "broken";
const RENDERABLE_IMAGE_USAGE = new Set(["permitted", "licensed"]);

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
  span = "1x1",
  brand,
  brandSlug,
  brandName,
  tracking,
}: SelectedProductTileProps) {
  const isEnglish = locale === "en";
  const name = (isEnglish ? product.nameEn : product.nameZh) ?? product.nameZh;
  const reason = isEnglish
    ? (product.rationaleEn ?? product.rationaleZh)
    : product.rationaleZh;
  const fact = isEnglish
    ? (product.notesEn ?? product.notesZh)
    : product.notesZh;
  const imageSrc =
    RENDERABLE_IMAGE_USAGE.has(product.imageUsage)
      ? safeImageSrc(product.imageUrl)
      : null;
  const isBroken = product.linkState === BROKEN_LINK_STATE;
  const isWallAnchor = mode === "wall" && span === "2x2";
  const visitLink =
    (mode === "outbound" || mode === "trail" || isWallAnchor) && brand
      ? getBrandVisitLink(brand)
      : null;
  const productHref = sanitizeHref(product.officialUrl);
  const chipHref = isBroken ? (visitLink?.href ?? null) : productHref;
  const chipLabel = isBroken ? labels.brandSiteCta : labels.cta;
  const chipLinkType = isBroken ? "brand_site" : "curated_product";
  const chipClassName = buttonVariants({
    variant: "secondary",
    shape: "pill",
    size: "compact",
    className: cn(
      "mt-auto max-w-full justify-center",
      mode === "trail" && "min-h-11",
    ),
  });
  const destinationSlug = brandSlug ?? brand?.slug ?? "";
  const internalHref = `/brands/${destinationSlug}#product-${product.key}`;
  const internalClassName =
    "group flex h-full flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-3";
  const wallImageSizes =
    span === "1x1"
      ? "(max-width: 640px) 50vw, 25vw"
      : "(max-width: 640px) 100vw, 50vw";
  const wallSpanClass =
    mode === "wall"
      ? span === "2x2"
        ? "col-span-2 row-span-2"
        : span === "2x1"
          ? "col-span-2"
          : undefined
      : undefined;
  const wallBadgeClass = imageSrc
    ? "absolute top-3 left-3 z-10 bg-foreground text-background"
    : "absolute top-3 left-3 z-10 border-border bg-card text-foreground";
  const wallBrandSiteClassName = buttonVariants({
    variant: "secondary",
    shape: "pill",
    size: "compact",
    className: "mx-4 mb-4 justify-center",
  });
  const wallBrandSiteLink = isWallAnchor && visitLink ? (
    <a
      href={visitLink.href}
      target="_blank"
      rel="noopener noreferrer"
      className={wallBrandSiteClassName}
      data-brand-slug={brand?.slug}
      data-link-type="brand_site"
      data-link-surface="selected_product"
    >
      <span className="min-w-0 truncate">{labels.brandSiteCta}</span>
      <span className="sr-only">{`: ${brandName ?? name}`}</span>
    </a>
  ) : null;

  const content = (
    <>
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={name}
            fill
            className={
              mode === "internal" || mode === "wall"
                ? "object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                : "object-cover"
            }
            sizes={
              mode === "wall"
                ? wallImageSizes
                : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            }
          />
        ) : (
          <BrandImageFallback name={name} category={product.l1} size="card" />
        )}
        {mode === "wall" ? (
          <Badge className={wallBadgeClass}>{labels.selectedBadge}</Badge>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {mode === "trail" ? (
          tracking ? (
            <SelectedProductTileLink
              href={internalHref}
              className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              productKey={product.key}
              brandSlug={tracking.brandSlug}
              position={tracking.position}
              surface={tracking.surface}
            >
              <Typography as="h3" variant="cardTitle" className="hover:text-primary">
                {name}
              </Typography>
            </SelectedProductTileLink>
          ) : (
            <Link
              href={internalHref}
              className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-ph-no-autocapture
            >
              <Typography as="h3" variant="cardTitle" className="hover:text-primary">
                {name}
              </Typography>
            </Link>
          )
        ) : (
          <Typography
            as="h3"
            variant="cardTitle"
            className={
              mode === "internal" || mode === "wall"
                ? "group-hover:text-primary"
                : undefined
            }
          >
            {name}
          </Typography>
        )}

        {(mode === "internal" || mode === "trail" || mode === "wall") &&
        brandName ? (
          <Typography as="p" variant="metadata">
            {brandName}
          </Typography>
        ) : null}

        {mode === "wall" ? (
          <div
            className={cn(
              "h-12 overflow-hidden transition-opacity duration-300 max-sm:h-0 max-sm:opacity-0",
              span === "2x2"
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            )}
          >
            <Typography as="p" variant="body" className="line-clamp-2">
              {reason}
            </Typography>
          </div>
        ) : reason ? (
          <>
            <Typography as="p" variant="body">
              {reason}
            </Typography>
            <div>
              <Badge variant="secondary">{labels.selectedBadge}</Badge>
            </div>
          </>
        ) : null}

        {mode !== "wall" && fact ? (
          <>
            <Typography as="p" variant="metadata">
              {fact}
            </Typography>
            <div>
              <Badge variant="declared">{labels.brandProvidedBadge}</Badge>
            </div>
          </>
        ) : null}

        {mode !== "wall" && isBroken ? (
          <Typography as="p" variant="metadata">
            {labels.unavailable}
          </Typography>
        ) : null}

        {(mode === "outbound" || mode === "trail") && chipHref ? (
          mode === "trail" && tracking && brand ? (
            <SelectedProductExternalLink
              href={chipHref}
              brandSlug={brand.slug}
              linkType={chipLinkType}
              referrerPage={tracking.referrerPage ?? "/discover"}
              surface={tracking.surface as `trail:${string}:${string}`}
              brandId={tracking.brandId}
              className={chipClassName}
            >
              <span className="min-w-0 truncate">{chipLabel}</span>
              {isBroken ? null : <span className="sr-only">{`: ${name}`}</span>}
            </SelectedProductExternalLink>
          ) : (
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
              {isBroken ? null : <span className="sr-only">{`: ${name}`}</span>}
            </a>
          )
        ) : null}
      </div>
    </>
  );

  return (
    <li
      id={`product-${product.key}`}
      className={surfaceCardStyles({
        padding: "none",
        className: cn("flex flex-col overflow-hidden", wallSpanClass),
      })}
    >
      {mode === "wall" ? (
        isWallAnchor ? (
          <div className="flex h-full flex-col">
            <Link
              href={internalHref}
              prefetch={false}
              className={internalClassName}
              data-ph-no-autocapture
            >
              {content}
            </Link>
            {wallBrandSiteLink}
          </div>
        ) : (
          <Link
            href={internalHref}
            prefetch={false}
            className={internalClassName}
            data-ph-no-autocapture
          >
            {content}
          </Link>
        )
      ) : mode === "internal" ? (
        tracking ? (
          <SelectedProductTileLink
            href={internalHref}
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
