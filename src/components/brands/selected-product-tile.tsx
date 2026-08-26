import { SurfaceImage } from "@/components/ui/image";
import type { CSSProperties } from "react";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { TrustLabel } from "@/components/ui/trust-label";
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
import { brandImageFill } from "@/lib/images/fill";
import type { CuratedProduct } from "@/lib/services/curated-products";
import { sanitizeHref } from "@/lib/url";
import { cn } from "@/lib/utils";
import { BrandImageFallback } from "./brand-image-fallback";
import { SelectedProductTileLink } from "./selected-product-tile-link";
import { SelectedProductExternalLink } from "./selected-product-external-link";
import { routes } from "@/lib/routes";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";

export type SelectedProductTileLabels = {
  cta: string;
  brandSiteCta: string;
  unavailable: string;
  madeInTaiwan?: string;
};

export type SelectedProductTileProps = {
  locale: AppLocale;
  product: CuratedProduct;
  labels: SelectedProductTileLabels;
  mode: "outbound" | "trail" | "wall";
  /**
   * THE CALLER'S OPT-IN TO THE SELECTED LABEL — a flag, because that is all it
   * ever was. It used to be `labels.selectedBadge`, a STRING whose value was
   * discarded: `TrustLabel` reads its own text from `trustLabel.selected`, so
   * the catalogue held the same sentence twice and only one copy could reach a
   * reader. A translator editing the other one saw nothing change.
   *
   * A flag, not a mode test, so a surface can withdraw the label without this
   * file learning which surface it is. Necessary but not sufficient: see
   * `rendersTrustLabel` below.
   */
  showsTrustLabel?: boolean;
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

/**
 * The selected-product tile stays server-rendered. Outbound product chips
 * preserve the brand-page behavior; the wall turns the whole tile into one
 * accessible link to that brand's page. The optional client link child adds
 * click tracking without moving the tile into the client graph.
 */
export function SelectedProductTile({
  locale,
  product,
  labels,
  mode,
  showsTrustLabel = false,
  ratio,
  className,
  brand,
  brandSlug,
  brandName,
  tracking,
}: SelectedProductTileProps) {
  const isEnglish = locale === "en";
  const name = (isEnglish ? product.nameEn : product.nameZh) ?? product.nameZh;
  /*
   * ONE text block per tile (DEV-1496). The three fields this replaced — a
   * selection rationale, a brand-page highlight rationale and a brand-supplied
   * note — collapsed into `product_description`, so there is nothing left to
   * choose between and no second badge to attach to a second block.
   *
   * `_zh` is the fallback because it is the NOT NULL column: an EN reader with
   * no English twin gets the Chinese text, never an empty block.
   */
  const productDescription = isEnglish
    ? (product.productDescriptionEn ?? product.productDescriptionZh)
    : product.productDescriptionZh;
  const imageSrc = safeImageSrc(product.imageUrl);
  /*
   * D11, THE CONTRAST RULE: a label renders only where its opposite is visible.
   *
   * `outbound` is the brand page, and it is the only place a selected product
   * sits among the brand's other things — so it is the only place the
   * label distinguishes anything. On the wall and in a trail every tile is
   * selected, so the label would repeat 32 times and say nothing; the trail's
   * own string was a different commitment and is dropped rather
   * than folded into this one.
   *
   * BOTH halves of the gate are load-bearing. The mode is Formoria's rule and
   * holds even for a caller that still opts in; the flag is the caller's
   * opt-in, so a surface can withdraw without editing this file.
   */
  const rendersTrustLabel = mode === "outbound" && showsTrustLabel;
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
    className: cn("mt-auto max-w-full justify-center"),
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
  const anchoredHref = `${routes.brand(destinationSlug)}#product-${product.key}`;
  const internalHref =
    mode === "wall" ? routes.brand(destinationSlug) : anchoredHref;
  const internalClassName =
    "group flex h-full flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-3";
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
   * The wall carries NO product text — product name and brand only.
   *
   * Removed deliberately on 2026-08-17: the copy read as generated product
   * specs ("lens and frame replaceable separately") rather than something a
   * reader wanted at that size, and the wall is a sheet of photographs. The
   * cost is accepted and real — the wall shows selections with neither a
   * per-tile trust label (removed earlier) nor any description, so
   * brand-voice.md's commitment is carried only by the surfaces below.
   *
   * `productDescription` still renders on every NON-wall mode
   * (outbound/trail) further down this file. Do not remove it there
   * without re-reading the "Trust labels" section of
   * docs/strategy/brand-voice.md: the Formoria-selection label is a deliberate
   * editorial choice for a specific context, argued in the trail that gathers
   * it. (Cited by section, not by line number: the line moved once already.)
   *
   * This band still exists for the name and brand: mobile puts it in flow
   * beneath the photograph, and from `sm` it is an absolutely positioned scrim
   * over the lower edge of the image, revealed on hover and focus.
   *
   * The scrim is SOLID canvas at 95% alpha, not a gradient: against a pure
   * black underlying pixel, `--ink-muted` measures 4.607:1. The 16px lead-in
   * above it fades, and deliberately carries no text.
   */
  const wallCaptionClass = cn(
    "flex flex-col gap-1 pt-3",
    "sm:absolute sm:inset-x-0 sm:bottom-0 sm:z-10 sm:rounded-b-surface sm:bg-ground/95 sm:p-4",
    "sm:transition-opacity sm:duration-300 motion-reduce:sm:duration-[0.01ms]",
    "[@media(hover:hover)]:sm:opacity-0",
    "[@media(hover:hover)]:sm:group-hover:opacity-100",
    "[@media(hover:hover)]:sm:group-focus-within:opacity-100",
  );
  const originBadge = product.mitQualified && labels.madeInTaiwan ? (
    <Badge
      variant="verified"
      className="absolute top-3 left-3 z-20"
      aria-label={labels.madeInTaiwan}
    >
      <ShieldCheck aria-hidden />
      {labels.madeInTaiwan}
    </Badge>
  ) : null;

  const wallContent = (
    <div className="relative flex h-full flex-col">
      <div
        data-wall-ratio={wallRatio}
        style={{ aspectRatio: wallAspectRatio }}
        // Container radius: the photo box is a top-level surface of the wall,
        // so it takes DESIGN.md's 6px container step, not the nested 4.8px one.
        className="relative w-full overflow-hidden rounded-surface bg-surface-deep"
      >
        {imageSrc ? (
          <SurfaceImage
            src={imageSrc}
            alt={name}
            fill
            // NEVER `priority`. The frame under the homepage opener is the
            // LCP element and owns the page's single preload; a wall tile
            // competing for `fetchpriority=high` is the regression this used
            // to guard against with a WALL_ABOVE_FOLD counter. The wall begins
            // below that photograph at every breakpoint, so nothing here is
            // above the fold. The photograph this defers to is the scrimmed
            // background of `hero-section.tsx` — it stopped being a block in
            // the flow, but it still claims the preload.
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:duration-[0.01ms]"
            surface="card"
            sizes={wallImageSizes}
          />
        ) : (
          <BrandImageFallback
            name={name}
            category={product.category}
            size="card"
          />
        )}
        {originBadge}
        {/* No selection badge here. The whole wall IS the selection — the section
            heading says so once — so a per-tile label repeated 32 times adds
            no information and breaks the sheet of photographs. The trust
            label still appears on every non-wall surface, where a selected
            product sits beside items that are not selected. */}
      </div>

      <div className={wallCaptionClass}>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-4 hidden h-4 bg-gradient-to-t from-ground/95 to-transparent sm:block"
        />
        <Typography
          as="h3"
          variant="cardTitle"
          className="group-hover:text-accent"
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
      {/*
       * 1:1 because that is the shape of the corpus, not a taste call — 53.5%
       * of product photography is EXACTLY square. DESIGN.md §5 Photography
       * owns the full measurement; do not restate the other figures here, or
       * the two copies drift apart the next time the corpus is measured.
       *
       * Fit mode is per-surface, as DEV-1407 established: cover where products
       * are compared side by side in a grid and a ragged edge would break the
       * row, contain where one product is shown large and losing its edges is
       * the worse cost.
       */}
      <div
        className={cn(
          "relative aspect-square w-full overflow-hidden",
          // Not cosmetic. A contained image letterboxes PERMANENTLY, so the
          // box must disappear into the `surfaceCardStyles` tone it sits in,
          // and that tone is still `bg-card` — `surfaceCardStyles` carries no
          // `bg-muted` to migrate, so this branch does not move with the rest.
          // A covered image only shows its box while loading, which is why
          // every other mode takes the `surface-deep` plate instead.
          mode === "trail" ? "bg-surface" : "bg-surface-deep",
        )}
      >
        {imageSrc ? (
          <SurfaceImage
            src={imageSrc}
            alt={name}
            fill
            // `brandImageFill` is the single definition of cover-vs-contain
            // (DESIGN.md §5). `null` meta is the point: curated products carry
            // no per-image framing data — see DEV-1519.
            className={brandImageFill(null, {
              fit: mode === "trail" ? "contain" : "cover",
            })}
            // NO `sizes` OVERRIDE, IN EITHER MODE. Both the brand page and the
            // trail lay these tiles out with `Grid cols="thirds"`
            // (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`), which is exactly
            // what the `tile` surface describes — so the surface IS the hint.
            //
            // The trail used to override with `(max-width: 768px) 100vw,
            // 720px`, written when a trail was a single 720px column. It is now
            // three-up, so that hint asked for roughly three times the pixels
            // it displays on every trail product image. An override is a string
            // nothing keeps honest: the column count moved and it did not.
            surface="tile"
          />
        ) : (
          <BrandImageFallback
            name={name}
            category={product.category}
            size="card"
          />
        )}
        {originBadge}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        {mode === "trail" ? (
          tracking ? (
            <SelectedProductTileLink
              href={internalHref}
              className="rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              productKey={product.key}
              brandSlug={tracking.brandSlug}
              position={tracking.position}
              surface={tracking.surface}
            >
              <Typography
                as="h3"
                variant="cardTitle"
                className="hover:text-accent"
              >
                {name}
              </Typography>
            </SelectedProductTileLink>
          ) : (
            <Link
              href={internalHref}
              className="rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              data-ph-no-autocapture
            >
              <Typography
                as="h3"
                variant="cardTitle"
                className="hover:text-accent"
              >
                {name}
              </Typography>
            </Link>
          )
        ) : (
          <Typography as="h3" variant="cardTitle">
            {name}
          </Typography>
        )}

        {mode === "trail" && brandName ? (
          <Typography as="p" variant="metadata">
            {brandName}
          </Typography>
        ) : null}

        {productDescription ? (
          <Typography as="p" variant="body">
            {productDescription}
          </Typography>
        ) : null}

        {rendersTrustLabel ? (
          <div>
            <TrustLabel />
          </div>
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
              referrerPage={tracking.referrerPage ?? routes.discover()}
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
      {content}
    </li>
  );
}
