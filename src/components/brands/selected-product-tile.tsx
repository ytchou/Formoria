import type { AppLocale } from "@/i18n/locale-preference";
import type { WallRatio } from "@/lib/curated-products/wall-ratio";
import { OutboundTile } from "./product-tile/outbound-tile";
import {
  ShelfTile,
  type SelectedProductTileGuide,
} from "./product-tile/shelf-tile";
import type {
  SelectedProductTileLabels,
  SelectedProductTileProduct,
  TileBrand,
} from "./product-tile/tile-fields";
import { TrailProductTile } from "./product-tile/trail-product-tile";
import { WallTile } from "./product-tile/wall-tile";

export type {
  SelectedProductTileGuide,
  SelectedProductTileLabels,
  SelectedProductTileProduct,
};

export type SelectedProductTileProps = {
  locale: AppLocale;
  product: SelectedProductTileProduct;
  labels: SelectedProductTileLabels;
  mode: "outbound" | "trail" | "wall" | "shelf";
  /** Trail-only editorial note for this pick (D13). */
  note?: string;
  /** Wall-only ratio bucket; absent renders the legacy 4:3. */
  ratio?: WallRatio;
  /** Explicit image measurement when a wall or trail uses a non-default column count. */
  imageSizes?: string;
  /** Wall-only Next image quality. */
  imageQuality?: number;
  /** Extra classes on the tile's `<li>`, in every mode. */
  className?: string;
  /** Brand-page fields used by the outbound link; `id` attributes shelf clicks. */
  brand?: TileBrand;
  /** Homepage/trail destination and visible brand name. */
  brandSlug?: string;
  brandName?: string;
  /** Optional click tracking (wall and trail); omitted for the inert variants. */
  tracking?: {
    brandSlug: string;
    position: number;
    surface: string;
    referrerPage?: string;
    brandId?: string;
  };
  /** Shelf-only: the guide that placed this product (CP2-15). */
  guide?: SelectedProductTileGuide;
  /** Shelf-only: called when the photo fails to load. */
  onImageError?: () => void;
};

/**
 * One selected-product tile per mode (BD-16): `wall` (homepage), `shelf`
 * (brand page), `trail` (discovery trail) and the inert `outbound`. Each mode
 * is its own component in `./product-tile/`, sharing the product-card frame and
 * caption; this dispatcher keeps the one import every call site already uses.
 *
 * Keep it isomorphic — no "use client", no hooks: the homepage's category
 * groups (DEV-1972) render it on the client, from a lazy chunk, after a chip
 * fetches its tiles. Click tracking lives in the small client link children.
 */
export function SelectedProductTile(props: SelectedProductTileProps) {
  const { locale, product, labels, className, imageSizes, brand } = props;
  switch (props.mode) {
    case "wall":
      return (
        <WallTile
          locale={locale}
          product={product}
          labels={labels}
          ratio={props.ratio}
          imageSizes={imageSizes}
          imageQuality={props.imageQuality}
          className={className}
          brand={brand}
          brandSlug={props.brandSlug}
          brandName={props.brandName}
          tracking={props.tracking}
        />
      );
    case "shelf":
      return (
        <ShelfTile
          locale={locale}
          product={product}
          labels={labels}
          brand={brand}
          className={className}
          guide={props.guide}
          onImageError={props.onImageError}
        />
      );
    case "trail":
      return (
        <TrailProductTile
          locale={locale}
          product={product}
          labels={labels}
          note={props.note}
          imageSizes={imageSizes}
          className={className}
          brand={brand}
          brandSlug={props.brandSlug}
          brandName={props.brandName}
          tracking={props.tracking}
        />
      );
    case "outbound":
      return (
        <OutboundTile
          locale={locale}
          product={product}
          labels={labels}
          imageSizes={imageSizes}
          className={className}
        />
      );
  }
}
