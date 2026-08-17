import Image from "next/image";
import type { CSSProperties } from "react";
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
  WALL_RATIOS,
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
   * Extra classes on the tile's `<li>`. The wall supplies its flex sizing and
   * the mobile cap through it; every other mode merges it too.
   */
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
  /*
   * The WALL lands on the top of the brand page; every other mode keeps the
   * `#product-` anchor.
   *
   * A homepage tile is the reader's FIRST contact with that brand, so dropping
   * them mid-page at one product skips the name, the trust labels and the rest
   * of the selection. From a trail or from another product on the same brand
   * page the anchor is still right — there the reader already has the context
   * and is asking for one specific item.
   *
   * The `id="product-<key>"` on the tile below stays either way: it is what the
   * brand page's own anchors point AT, and removing it would break those.
   */
  const anchoredHref = `/brands/${destinationSlug}#product-${product.key}`;
  const internalHref =
    mode === "wall" ? `/brands/${destinationSlug}` : anchoredHref;
  const internalClassName =
    "group flex h-full flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-3";
  // One column on phones, two on tablets, four above 1024px. The four-column
  // measure is `(min(100vw, 100rem) - 5rem - 4.5rem) / 4`, which tops out at
  // 362px once the container hits its 100rem cap — so `25vw` below that and a
  // fixed candidate above it, rather than asking for an oversized image on
  // every wide desktop.
  const wallImageSizes =
    "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1600px) 25vw, 362px";
  const wallRatio: WallRatio = ratio ?? DEFAULT_WALL_RATIO;
  const wallAspectRatio = wallRatio.replace(":", " / ");
  /*
   * The wall carries NO selection rationale — product name and brand only.
   *
   * Removed deliberately on 2026-08-17: the reasons read as generated product
   * specs ("lens and frame replaceable separately") rather than editorial
   * reasons for choosing the product, and the wall is
   * a sheet of photographs. The cost is accepted and real — the wall now shows
   * selections with neither a per-tile trust label (removed earlier) nor a
   * stated reason, so
   * brand-voice.md's "always with a stated reason" is carried only by the
   * surfaces below, and the homepage no longer exposes a machine-readable
   * `[data-selection-rationale]` for answer engines.
   *
   * `reason` still renders on every NON-wall mode (internal/outbound/trail)
   * further down this file. Do not remove it there without re-reading
   * docs/strategy/brand-voice.md:71.
   *
   * This band still exists for the name and brand: mobile puts it in flow
   * beneath the photograph, and from `sm` it is an absolutely positioned scrim
   * over the lower edge of the image, revealed on hover and focus.
   *
   * The scrim is SOLID canvas at 94% alpha, not a gradient: composited over a
   * dark photograph, paper falls below 4.5:1 wherever alpha drops under ~51%.
   * The 16px lead-in above it fades, and deliberately carries no text.
   */
  const wallCaptionClass = cn(
    "flex flex-col gap-1 pt-3",
    "sm:absolute sm:inset-x-0 sm:bottom-0 sm:z-10 sm:rounded-b-lg sm:bg-background/94 sm:p-4",
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
        // Container radius: the photo box is a top-level surface of the wall,
        // so it takes DESIGN.md's 6px container step, not the nested 4.8px one.
        className="relative w-full overflow-hidden rounded-lg bg-muted"
      >
        {imageSrc ? (
          <Image
            src={imageSrc}
            alt={name}
            fill
            // NEVER `priority`. The hero photograph is the LCP element and
            // owns the page's single preload; a wall tile competing for
            // `fetchpriority=high` is the regression this used to guard
            // against with a WALL_ABOVE_FOLD counter. The wall begins below
            // the hero at every breakpoint, so nothing here is above the fold.
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:duration-[0.01ms]"
            sizes={wallImageSizes}
          />
        ) : (
          <BrandImageFallback name={name} category={product.l1} size="card" />
        )}
        {/* No selection badge here. The whole wall IS the selection — the section
            heading says so once — so a per-tile label repeated 32 times adds
            no information and breaks the sheet of photographs. The trust
            label still appears on every non-wall surface, where a selected
            product sits beside items that are not selected. */}
      </div>

      <div className={wallCaptionClass}>
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
    // the caption band can sit flush over the lower edge of the image.
    return (
      <li
        id={`product-${product.key}`}
        // Both `flex-basis` and `flex-grow` proportional to the ratio is what
        // makes the line justify: see the header of `product-wall.tsx`. Set as
        // a custom property because Tailwind cannot emit a class built from a
        // runtime value, and the two arbitrary properties below then read it.
        style={{ "--tile-ratio": WALL_RATIOS[wallRatio] } as CSSProperties}
        className={cn(
          "relative list-none",
          // Phones are one tile per line, so the tile takes the whole basis and
          // never grows; from `sm` the ratio drives both.
          "basis-full grow-0",
          "sm:basis-[calc(var(--wall-line-h)*var(--tile-ratio))] sm:grow-[var(--tile-ratio)]",
          className,
        )}
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
        // `className` is accepted for every mode, so it must be merged here too
        // — dropping it silently gave a caller no styling and no type error.
        className: cn("flex flex-col overflow-hidden", className),
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
