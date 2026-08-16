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
import {
  DEFAULT_WALL_RATIO,
  type WallRatio,
} from "@/lib/curated-products/wall-ratio";
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
  /**
   * Wall geometry: the snapped ratio bucket the tile renders at. Absent means
   * the row carries no measurement yet, which renders the legacy 4:3.
   */
  ratio?: WallRatio;
  /**
   * Wall-only position, used for the LCP decision. Removing the hero photo made
   * the first wall tile the LCP element, so the first row must not be lazy.
   */
  wallIndex?: number;
  /** Wall-only grid classes (row span, mobile cap) supplied by the wall itself. */
  className?: string;
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
 * The widest wall column count, which is exactly the first visible row. Those
 * tiles carry `priority`; everything after them stays lazy. Mirrors
 * `MASONRY_ABOVE_FOLD` deliberately — same reasoning, different surface.
 */
export const WALL_ABOVE_FOLD = 4;

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
  ratio,
  wallIndex,
  className,
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
  const imageSrc = RENDERABLE_IMAGE_USAGE.has(product.imageUsage)
    ? safeImageSrc(product.imageUrl)
    : null;
  const isBroken = product.linkState === BROKEN_LINK_STATE;
  const visitLink =
    (mode === "outbound" || mode === "trail") && brand
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
  // One column on phones, two on tablets, four at the 1280px cap.
  const wallImageSizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw";
  const wallRatio: WallRatio = ratio ?? DEFAULT_WALL_RATIO;
  const wallAspectRatio = wallRatio.replace(":", " / ");
  const isWallPriority =
    mode === "wall" && wallIndex !== undefined && wallIndex < WALL_ABOVE_FOLD;
  const wallBadgeClass = imageSrc
    ? "absolute top-3 left-3 z-10 bg-foreground text-background"
    : "absolute top-3 left-3 z-10 border-border bg-card text-foreground";
  const wallReason = reason?.trim() ? reason.trim() : null;

  /*
   * ONE reason node, repositioned — never two.
   *
   * Mobile puts it in flow beneath the photograph on a transparent band;
   * from `sm` it becomes an absolutely positioned scrim over the lower edge of
   * the image, revealed on hover and focus. Position and background are the
   * only breakpoint deltas, because the e2e contract (and the crawler) require
   * exactly one `[data-selection-rationale]` per tile.
   *
   * The scrim is SOLID canvas at 94% alpha, not a gradient: composited over a
   * dark photograph, paper falls below 4.5:1 wherever alpha drops under ~51%.
   * The 16px lead-in above it fades, and deliberately carries no text.
   */
  const wallReasonClass = cn(
    "flex flex-col gap-1 pt-3",
    "sm:absolute sm:inset-x-0 sm:bottom-0 sm:z-10 sm:rounded-b-md sm:bg-background/94 sm:p-4",
    "sm:transition-opacity sm:duration-300 motion-reduce:sm:duration-[0.01ms]",
    "[@media(hover:hover)]:sm:opacity-0",
    "[@media(hover:hover)]:sm:group-hover:opacity-100",
    "[@media(hover:hover)]:sm:group-focus-within:opacity-100",
  );

  const wallContent = (
    <div className="relative flex h-full flex-col">
      <div
        data-wall-ratio={wallRatio}
        style={{ aspectRatio: wallAspectRatio }}
        className="relative w-full overflow-hidden rounded-md bg-muted"
      >
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={name}
            fill
            priority={isWallPriority}
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:duration-[0.01ms]"
            sizes={wallImageSizes}
          />
        ) : (
          <BrandImageFallback name={name} category={product.l1} size="card" />
        )}
        <Badge className={wallBadgeClass}>{labels.selectedBadge}</Badge>
      </div>

      <div className={wallReasonClass}>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-4 hidden h-4 bg-gradient-to-t from-background/94 to-transparent sm:block"
        />
        <Typography
          as="h3"
          variant="cardTitle"
          className="group-hover:text-primary"
        >
          {name}
        </Typography>
        {brandName ? (
          // 13px muted is the floor: measured 4.6:1 over the scrim, AA with
          // almost no margin. Never smaller, never lighter.
          <Typography as="p" variant="metadata">
            {brandName}
          </Typography>
        ) : null}
        {wallReason ? (
          <Typography
            as="p"
            variant="body"
            className="line-clamp-3"
            data-selection-rationale={wallReason}
          >
            {wallReason}
          </Typography>
        ) : null}
      </div>
    </div>
  );

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
                ? "object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:duration-[0.01ms]"
                : "object-cover"
            }
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        ) : (
          <BrandImageFallback name={name} category={product.l1} size="card" />
        )}
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
              <Typography
                as="h3"
                variant="cardTitle"
                className="hover:text-primary"
              >
                {name}
              </Typography>
            </SelectedProductTileLink>
          ) : (
            <Link
              href={internalHref}
              className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-ph-no-autocapture
            >
              <Typography
                as="h3"
                variant="cardTitle"
                className="hover:text-primary"
              >
                {name}
              </Typography>
            </Link>
          )
        ) : (
          <Typography
            as="h3"
            variant="cardTitle"
            className={
              mode === "internal" ? "group-hover:text-primary" : undefined
            }
          >
            {name}
          </Typography>
        )}

        {(mode === "internal" || mode === "trail") && brandName ? (
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

  if (mode === "wall") {
    // The wall tile is a photograph, not a card: no border, no card surface, so
    // the reason band can sit flush over the lower edge of the image.
    return (
      <li
        id={`product-${product.key}`}
        className={cn("relative list-none", className)}
      >
        {tracking ? (
          <SelectedProductTileLink
            href={internalHref}
            prefetch={false}
            className={internalClassName}
            productKey={product.key}
            brandSlug={tracking.brandSlug}
            position={tracking.position}
            surface={tracking.surface}
          >
            {wallContent}
          </SelectedProductTileLink>
        ) : (
          <Link
            href={internalHref}
            prefetch={false}
            className={internalClassName}
            data-ph-no-autocapture
          >
            {wallContent}
          </Link>
        )}
      </li>
    );
  }

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
