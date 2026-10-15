import type { CSSProperties, ReactNode } from "react";

import { BrandImageFallback } from "@/components/brands/brand-image-fallback";
import { separatorBreaks } from "@/components/brands/product-tile/separator-breaks";
import { IMAGE_SURFACE_SIZES, SurfaceImage } from "@/components/ui/image";
import { Typography } from "@/components/ui/typography";
import { mediaHoverImage, mediaHoverTitle } from "@/lib/design/media-hover";
import { brandImageFill } from "@/lib/images/fill";
import { cn } from "@/lib/utils";

/*
 * ONE PRODUCT-CARD GRAMMAR (DS-04, EL-05, EL-08). The four selected-product
 * tile modes and the /discover `ProductCard` were five compositions with five
 * image boxes and three caption orders. They now share the photo frame and the
 * caption below; a mode differs only in the extra row it puts under the name.
 */

type FrameImageSizing =
  | { surface: keyof typeof IMAGE_SURFACE_SIZES; sizes?: string }
  | { surface?: never; sizes: string };

export type ProductCardFrameProps = FrameImageSizing & {
  /** `safeImageSrc` output; null renders the letter fallback. */
  src: string | null;
  /** Image alt and the fallback's initial: the product name. */
  name: string;
  category?: string | null;
  /** A CSS `aspect-ratio`, e.g. `4 / 3`. Absent means square. */
  aspectRatio?: string;
  quality?: number;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  onError?: () => void;
  /** Absolutely positioned over the photo: the 台灣製造 origin badge. */
  badge?: ReactNode;
  /** Pass-through `data-*` attributes (the wall's `data-wall-ratio`). */
  [dataAttribute: `data-${string}`]: string | undefined;
};

/**
 * The photo box. 1:1 by default because that is the shape of the corpus, not
 * a taste call — DESIGN.md §5 Photography owns the measurement. Every card is
 * in a grid where products sit side by side, so the image always covers
 * (DEV-1407); `brandImageFill` is the single definition of cover, and `null`
 * meta is the point — curated products carry no per-image framing data
 * (DEV-1519).
 *
 * `tone="paper"` multiplies a white product ground onto the frame's `surface`
 * plate, and the inset hairline outline gives a white-on-white photo an edge
 * (EL-08); `isolate` keeps the blend inside the frame. The container radius is
 * DESIGN.md's 6px step: the frame is a top-level surface of the card.
 */
export function ProductCardFrame({
  src,
  name,
  category,
  aspectRatio,
  surface,
  sizes,
  quality,
  loading,
  fetchPriority,
  onError,
  badge,
  ...dataAttributes
}: ProductCardFrameProps) {
  const style: CSSProperties | undefined = aspectRatio
    ? { aspectRatio }
    : undefined;
  const sizing = surface ? { surface, sizes } : { sizes: sizes as string };
  return (
    <div
      {...dataAttributes}
      style={style}
      className={cn(
        "relative isolate w-full overflow-hidden rounded-surface bg-surface outline outline-1 -outline-offset-1 outline-ink/10",
        // A caller-supplied ratio drives the box inline; an aspect utility
        // alongside it would override it.
        !aspectRatio && "aspect-square",
      )}
    >
      {src ? (
        <SurfaceImage
          src={src}
          alt={name}
          fill
          tone="paper"
          className={cn(
            brandImageFill(null, { fit: "cover" }),
            mediaHoverImage,
          )}
          {...sizing}
          quality={quality}
          loading={loading}
          fetchPriority={fetchPriority}
          onError={onError}
        />
      ) : (
        <BrandImageFallback name={name} category={category} size="card" />
      )}
      {badge}
    </div>
  );
}

export type ProductCardCaptionProps = {
  /** The brand line: plain text, or the trail's brand-page link. */
  brand?: ReactNode;
  brandClassName?: string;
  name: string;
  nameLang?: string;
  /** Mode-specific additions to the shared name style (clamp, flex sizing). */
  nameClassName?: string;
  /** Wraps the name heading — the trail's outbound link, the shelf's ↗ row. */
  renderName?: (heading: ReactNode) => ReactNode;
  className?: string;
  /** The mode-specific extra row(s) under the name. */
  children?: ReactNode;
};

/**
 * The caption, in one order for every card: brand line → name → extra.
 *
 * The brand line is content: Ming, muted, never accent at rest (DS2-19), and
 * 15px — Ming strokes break below ~14px. The name steps down to body size on
 * phones (there is no smaller card-title token) and clamps to two lines
 * (DS2-20). `wrap-break-word` under `:lang(zh)` out-ranks the card title's zh
 * `overflow-wrap: anywhere` (N-02), which let `text-wrap: balance` split
 * "Orii×DO / T" mid-word; `break-word` splits only a word wider than the whole
 * line, so nothing overflows. `break-keep` joins it only when the name has a
 * separator to break at (BD-13, see `separatorBreaks`).
 */
export function ProductCardCaption({
  brand,
  brandClassName,
  name,
  nameLang,
  nameClassName,
  renderName,
  className,
  children,
}: ProductCardCaptionProps) {
  const { node, hasBreaks } = separatorBreaks(name);
  const heading = (
    <Typography
      as="h3"
      variant="cardTitle"
      className={cn(
        "max-sm:type-body max-sm:text-ink line-clamp-2 [&:lang(zh)]:wrap-break-word",
        hasBreaks && "[&:lang(zh)]:break-keep",
        mediaHoverTitle,
        nameClassName,
      )}
      lang={nameLang}
    >
      {node}
    </Typography>
  );
  return (
    <div className={cn("flex flex-col gap-1 pt-3", className)}>
      {brand ? (
        <p className={cn("type-body-sm text-ink-muted", brandClassName)}>
          {brand}
        </p>
      ) : null}
      {renderName ? renderName(heading) : heading}
      {children}
    </div>
  );
}
