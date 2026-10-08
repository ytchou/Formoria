import { SurfaceImage } from "@/components/ui/image";
import type { CSSProperties } from "react";
import { Link } from "@/i18n/navigation";
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
import { brandImageFill } from "@/lib/images/fill";
import type { CuratedProduct } from "@/lib/services/curated-products";
import { sanitizeHref } from "@/lib/url";
import { cn } from "@/lib/utils";
import { BrandImageFallback } from "./brand-image-fallback";
import { SelectedProductTileLink } from "./selected-product-tile-link";
import { SelectedProductExternalLink } from "./selected-product-external-link";
import { SaveButton } from "@/components/ui/save-button";
import { routes } from "@/lib/routes";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";
import { subcategoryDisplayLabel } from "@/lib/taxonomy/ontology";

export type SelectedProductTileLabels = {
  cta: string;
  brandSiteCta: string;
  unavailable: string;
  madeInTaiwan?: string;
};

/**
 * Exactly the product fields this tile reads, in ANY mode. Narrower than
 * `CuratedProduct` so a client-fetched homepage group (DEV-1972) can ship a
 * projection instead of the whole row; every `CuratedProduct` still fits.
 * Add a field here when the tile starts reading it.
 */
export type SelectedProductTileProduct = Pick<
  CuratedProduct,
  | "id"
  | "key"
  | "nameZh"
  | "nameEn"
  | "productDescriptionZh"
  | "productDescriptionEn"
  | "imageUrl"
  | "subcategory"
  | "category"
  | "linkState"
  | "officialUrl"
  | "mitQualified"
>;

export type SelectedProductTileProps = {
  locale: AppLocale;
  product: SelectedProductTileProduct;
  labels: SelectedProductTileLabels;
  mode: "outbound" | "trail" | "wall" | "shelf";
  /**
   * Trail-only editorial note for this pick (D13), authored in the trail's
   * frontmatter. Ignored in every other mode.
   */
  note?: string;
  /**
   * Wall geometry: the snapped ratio bucket the tile renders at. Absent means
   * the row carries no measurement yet, which renders the legacy 4:3.
   */
  ratio?: WallRatio;
  /** Explicit image measurement when a wall uses a non-default column count. */
  imageSizes?: string;
  /** Optional Next image quality for a specific wall. */
  imageQuality?: number;
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
 * The selected-product tile stays server-rendered. Trail cards keep their
 * outbound product chip. Brand-page shelf cards are a route onward (DEV-1950):
 * image and name link to the product's anchor, and a route row carries the
 * outbound chip. The wall turns the whole tile into one accessible link to
 * that brand's page. The optional client link child adds click tracking
 * without moving the tile into the client graph.
 *
 * Keep it isomorphic: the homepage's category groups (DEV-1972) render it on
 * the client, from a lazy chunk, after a chip fetches its tiles.
 */
export function SelectedProductTile({
  locale,
  product,
  labels,
  mode,
  ratio,
  imageSizes,
  imageQuality,
  className,
  brand,
  brandSlug,
  brandName,
  tracking,
  note,
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
  // WCAG 3.1.2: an EN page showing the zh fallback marks that part as zh.
  const nameLang = isEnglish && !product.nameEn ? "zh-Hant-TW" : undefined;
  const descriptionLang =
    isEnglish && !product.productDescriptionEn && product.productDescriptionZh
      ? "zh-Hant-TW"
      : undefined;
  const imageSrc = safeImageSrc(product.imageUrl);
  // Render-side guard: a 選物 shelf tile never draws a letter placeholder. The
  // data-side publish precondition (no photo, no publish) is a separate ticket.
  if (mode === "shelf" && !imageSrc) return null;
  const subcategoryName = product.subcategory
    ? subcategoryDisplayLabel(product.subcategory, locale)
    : null;
  const isBroken = product.linkState === BROKEN_LINK_STATE;
  const visitLink =
    (mode === "trail" || mode === "shelf") && brand
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
  // The untracked outbound chip, shared by the trail and the shelf route row.
  const plainChip = chipHref ? (
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
  ) : null;
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
   * cost is accepted and real — the wall shows selections without a per-tile
   * trust label or description, so the surrounding section carries the
   * editorial context.
   *
   * `productDescription` still renders on every NON-wall mode
   * (outbound/trail) further down this file. Do not remove it there
   * without re-reading the "Trust labels" section of
   * docs/strategy/brand-voice.md: the Formoria-selection label is a deliberate
   * editorial choice for a specific context, argued in the trail that gathers
   * it. (Cited by section, not by line number: the line moved once already.)
   *
   * The name and brand stay, in flow beneath the photograph at EVERY
   * viewport (DS-10). They used to be a hover-revealed scrim from `sm`, which
   * left desktop readers a sheet of unlabelled photographs at rest and hid
   * them from anyone who never hovers.
   */
  const wallCaptionClass = cn(
    "flex flex-col gap-1 pt-3",
    // Ancestor variant (`:where(.bg-ground) &`): on the homepage band's ground
    // plate the caption is inset from the plate's edge; a bare wall stays flush.
    "in-[.bg-ground]:px-3 in-[.bg-ground]:pb-3",
  );
  const originBadge =
    product.mitQualified && labels.madeInTaiwan ? (
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
            sizes={imageSizes ?? wallImageSizes}
            quality={imageQuality}
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
            no information and breaks the sheet of photographs. */}
      </div>

      <div className={wallCaptionClass}>
        <Typography
          as="h3"
          variant="cardTitle"
          className="group-hover:text-accent"
          lang={nameLang}
        >
          {name}
        </Typography>
        {brandName ? (
          // 13px muted is the floor for AA on the ground. Never smaller, never
          // lighter.
          <Typography as="p" variant="metadata">
            {brandName}
          </Typography>
        ) : null}
        {subcategoryName ? (
          <Badge variant="declared" className="self-start">
            {subcategoryName}
          </Badge>
        ) : null}
      </div>
    </div>
  );

  const shelfContent = (
    <div className="relative flex h-full flex-col">
      <Link
        href={internalHref}
        prefetch={false}
        className="group flex flex-col rounded-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-3"
        data-ph-no-autocapture
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-surface bg-surface-deep">
          {imageSrc ? (
            <SurfaceImage
              src={imageSrc}
              alt={name}
              fill
              className="object-cover transition-transform duration-300 ease-(--ease-settle) group-hover:scale-[1.03]"
              sizes="(max-width: 640px) 80vw, (max-width: 1024px) 45vw, (max-width: 1600px) 23vw, 368px"
            />
          ) : null}
          {originBadge}
        </div>
        <Typography
          as="h3"
          variant="cardTitle"
          className="mt-3 group-hover:text-accent"
          lang={nameLang}
        >
          {name}
        </Typography>
      </Link>
      {/* A sibling of the link, never inside it: a button inside an `<a>` is
          invalid. The overlay variant pins it to this box's top-right corner,
          which is the image's corner because the link starts at the top. */}
      <SaveButton
        kind="product"
        id={product.id}
        slug={product.key}
        variant="overlay"
      />
      {productDescription ? (
        <p
          className="mt-1 type-body-sm text-ink-muted line-clamp-2"
          lang={descriptionLang}
        >
          {productDescription}
        </p>
      ) : null}
      {subcategoryName ? (
        <Badge variant="declared" className="mt-2 self-start">
          {subcategoryName}
        </Badge>
      ) : null}
      {isBroken ? (
        <Typography as="p" variant="metadata" className="mt-2">
          {labels.unavailable}
        </Typography>
      ) : null}
      {plainChip ? <div className="mt-auto pt-3">{plainChip}</div> : null}
    </div>
  );

  // DESIGN.md §7: a 44px-tall centered `::after` overlay (`min-h-11`) grows
  // the trail name's hit area without resizing its text (DS-39).
  const trailNameLinkClassName =
    "relative rounded-control after:absolute after:inset-x-0 after:top-1/2 after:h-full after:min-h-11 after:-translate-y-1/2 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

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
       * row, contain where one product is shown large. Every mode here is a
       * grid — the trail included, three-up since DS-26 — so all of them cover.
       */}
      {/* A covered image only shows its box while loading, so the box takes
          the `surface-deep` placeholder plate (DESIGN.md §2). */}
      <div className="relative aspect-square w-full overflow-hidden bg-surface-deep">
        {imageSrc ? (
          <SurfaceImage
            src={imageSrc}
            alt={name}
            fill
            // `brandImageFill` is the single definition of cover-vs-contain
            // (DESIGN.md §5). `null` meta is the point: curated products carry
            // no per-image framing data — see DEV-1519.
            className={brandImageFill(null, { fit: "cover" })}
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
              className={trailNameLinkClassName}
              productKey={product.key}
              brandSlug={tracking.brandSlug}
              position={tracking.position}
              surface={tracking.surface}
            >
              <Typography
                as="h3"
                variant="cardTitle"
                className="hover:text-accent"
                lang={nameLang}
              >
                {name}
              </Typography>
            </SelectedProductTileLink>
          ) : (
            <Link
              href={internalHref}
              className={trailNameLinkClassName}
              data-ph-no-autocapture
            >
              <Typography
                as="h3"
                variant="cardTitle"
                className="hover:text-accent"
                lang={nameLang}
              >
                {name}
              </Typography>
            </Link>
          )
        ) : (
          <Typography as="h3" variant="cardTitle" lang={nameLang}>
            {name}
          </Typography>
        )}

        {/* The note is content, so 明體 at body size; the brand line below
            stays 黑體 metadata in ink-muted (D14). */}
        {mode === "trail" && note ? (
          <p className="type-body line-clamp-2">{note}</p>
        ) : null}

        {mode === "trail" && brandName ? (
          <Typography as="p" variant="metadata">
            {brandName}
          </Typography>
        ) : null}

        {productDescription ? (
          mode === "trail" ? (
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
              {productDescription}
            </p>
          ) : (
            <Typography as="p" variant="body" lang={descriptionLang}>
              {productDescription}
            </Typography>
          )
        ) : null}

        {isBroken ? (
          <Typography as="p" variant="metadata">
            {labels.unavailable}
          </Typography>
        ) : null}

        {mode === "trail" && chipHref ? (
          tracking && brand ? (
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
            plainChip
          )
        ) : null}
      </div>
    </>
  );

  if (mode === "wall") {
    // The wall tile is a photograph, not a card: no border, no card surface; the
    // caption sits in flow beneath the image.
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

  if (mode === "shelf") {
    return (
      <li
        id={`product-${product.key}`}
        className={cn("relative list-none", className)}
      >
        {shelfContent}
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
