import type { CSSProperties } from "react";

import { Badge } from "@/components/ui/badge";
import {
  ProductCardCaption,
  ProductCardFrame,
} from "@/components/products/product-card-frame";
import type { AppLocale } from "@/i18n/locale-preference";
import { Link } from "@/i18n/navigation";
import {
  DEFAULT_WALL_RATIO,
  WALL_RATIOS,
  type WallRatio,
} from "@/lib/curated-products/wall-ratio";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { SelectedProductTileLink } from "../selected-product-tile-link";
import { OriginBadge } from "./origin-badge";
import {
  tileFields,
  type SelectedProductTileLabels,
  type SelectedProductTileProduct,
} from "./tile-fields";

export type WallTileProps = {
  locale: AppLocale;
  product: SelectedProductTileProduct;
  labels: SelectedProductTileLabels;
  /**
   * The snapped ratio bucket the tile renders at. Absent means the row carries
   * no measurement yet, which renders the legacy 4:3.
   */
  ratio?: WallRatio;
  /** Explicit image measurement when a wall uses a non-default column count. */
  imageSizes?: string;
  /** Optional Next image quality for a specific wall. */
  imageQuality?: number;
  /** Extra `<li>` classes: the wall's flex sizing and the mobile cap. */
  className?: string;
  brand?: { slug: string };
  brandSlug?: string;
  brandName?: string;
  /** Optional homepage click tracking. */
  tracking?: { brandSlug: string; position: number; surface: string };
};

// One column on phones, two on tablets, four above 1024px. The four-column
// measure is `(min(100vw, 100rem) - 5rem - 4.5rem) / 4`, which tops out at
// 362px once the container hits its 100rem cap — so `25vw` below that and a
// fixed candidate above it, rather than asking for an oversized image on
// every wide desktop.
const WALL_IMAGE_SIZES =
  "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, (max-width: 1600px) 25vw, 362px";

const LINK_CLASS_NAME =
  "group flex h-full flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-3";

/**
 * A homepage wall tile: a photograph, not a card — no border, no card surface,
 * the caption in flow beneath the image. The whole tile is one accessible link
 * to the brand page.
 *
 * It lands on the TOP of the brand page, never a `#product-` anchor. A
 * homepage tile is the reader's FIRST contact with that brand, so dropping
 * them mid-page at one product skips the name, the trust labels and the rest
 * of the selection. The `id="product-<key>"` on the tile stays: it is what the
 * brand page's own anchors point AT, and removing it would break those.
 */
export function WallTile({
  locale,
  product,
  labels,
  ratio,
  imageSizes,
  imageQuality,
  className,
  brand,
  brandSlug,
  brandName,
  tracking,
}: WallTileProps) {
  const { name, nameBreaks, nameLang, imageSrc, subcategoryName } =
    tileFields(product, locale, labels);
  const href = routes.brand(brandSlug ?? brand?.slug ?? "");
  const wallRatio: WallRatio = ratio ?? DEFAULT_WALL_RATIO;

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
   * The description still renders on every NON-wall mode (outbound/trail).
   * Do not remove it there without re-reading the "Trust labels" section of
   * docs/strategy/brand-voice.md: the Formoria-selection label is a deliberate
   * editorial choice for a specific context, argued in the trail that gathers
   * it. (Cited by section, not by line number: the line moved once already.)
   *
   * The name and brand stay, in flow beneath the photograph at EVERY
   * viewport (DS-10). They used to be a hover-revealed scrim from `sm`, which
   * left desktop readers a sheet of unlabelled photographs at rest and hid
   * them from anyone who never hovers.
   */
  const content = (
    <div className="relative flex h-full flex-col">
      {/* NEVER `priority`. The frame under the homepage opener is the LCP
          element and owns the page's single preload; a wall tile competing
          for `fetchpriority=high` is the regression this used to guard against
          with a WALL_ABOVE_FOLD counter. The wall begins below that photograph
          at every breakpoint, so nothing here is above the fold. The
          photograph this defers to is the scrimmed background of
          `hero-section.tsx` — it stopped being a block in the flow, but it
          still claims the preload. */}
      <ProductCardFrame
        src={imageSrc}
        name={name}
        category={product.category}
        aspectRatio={wallRatio.replace(":", " / ")}
        data-wall-ratio={wallRatio}
        sizes={imageSizes ?? WALL_IMAGE_SIZES}
        quality={imageQuality}
        // No selection badge here. The whole wall IS the selection — the
        // section heading says so once — so a per-tile label repeated 32 times
        // adds no information and breaks the sheet of photographs.
        badge={
          <OriginBadge
            mitQualified={product.mitQualified}
            label={labels.madeInTaiwan}
          />
        }
      />
      <ProductCardCaption
        brand={brandName}
        name={name}
        nameBreaks={nameBreaks}
        nameLang={nameLang}
        // Ancestor variant (`:where(.bg-ground) &`): on the homepage band's
        // ground plate the caption is inset from the plate's edge; a bare
        // wall stays flush.
        className="in-[.bg-ground]:px-3 in-[.bg-ground]:pb-3"
      >
        {subcategoryName ? (
          <Badge variant="declared" className="self-start">
            {subcategoryName}
          </Badge>
        ) : null}
      </ProductCardCaption>
    </div>
  );

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
          href={href}
          prefetch={false}
          className={LINK_CLASS_NAME}
          productKey={product.key}
          brandSlug={tracking.brandSlug}
          position={tracking.position}
          surface={tracking.surface}
        >
          {content}
        </SelectedProductTileLink>
      ) : (
        <Link
          href={href}
          prefetch={false}
          className={LINK_CLASS_NAME}
          data-ph-no-autocapture
        >
          {content}
        </Link>
      )}
    </li>
  );
}
