import NextImage, { type ImageProps as NextImageProps } from "next/image";

/**
 * `next/image`, with `sizes` derived from the surface instead of retyped.
 *
 * Seventeen files hand-wrote a `sizes` string across twenty-three call sites.
 * Three of them described the same four-up card grid with three different
 * strings, and nothing connected any of them to the grid that actually laid the
 * cards out — so a column-count change moved the layout and left every `sizes`
 * hint describing the old one. A wrong hint is invisible: the page renders
 * correctly and quietly downloads the wrong image.
 *
 * `surface` is REQUIRED and has no default. That is the whole mechanism: a card
 * and a hero cannot end up sharing one string by omission, because omission is
 * a type error.
 *
 * `alt` stays required, exactly as `next/image` declares it. Decorative images
 * pass `alt=""` — an explicit statement that the image carries no information —
 * and informative ones describe what the image conveys. Making `alt` optional
 * would let a missing description read as a decorative one.
 */
export const IMAGE_SURFACE_SIZES = {
  /** Full-bleed band: page hero, section backdrop. */
  hero: "100vw",
  /** Content-column image capped at the measure — a story or trail hero. */
  banner: "(max-width: 1280px) 100vw, 1280px",
  /** A cell of the four-up card grid. Mirrors `CARD_GRID_COLUMNS`. */
  card: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw",
  /** A cell of a three-up grid. */
  tile: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
  /** One half of a two-column split from `md` up. */
  split: "(max-width: 768px) 100vw, 50vw",
  /** A small fixed square: row thumbnail, carousel strip, avatar slot. */
  thumb: "96px",
} as const;

export type ImageSurface = keyof typeof IMAGE_SURFACE_SIZES;

export type SurfaceImageProps = Omit<NextImageProps, "sizes" | "alt"> & {
  /** Which layout slot this image occupies. Drives `sizes`. */
  surface: ImageSurface;
  /**
   * Required, and never inferred. `alt=""` for decorative; a description of
   * what the image conveys otherwise.
   */
  alt: string;
  /**
   * Overrides the surface's `sizes` for a box the vocabulary above cannot
   * describe — a fixed-pixel admin preview, a share-card render, a printed
   * floor map. It is deliberately awkward: every use should carry a comment
   * saying what the box measures, because an override is a hint nothing else
   * keeps honest.
   */
  sizes?: string;
};

export function SurfaceImage({
  surface,
  sizes,
  ...props
}: SurfaceImageProps) {
  return <NextImage sizes={sizes ?? IMAGE_SURFACE_SIZES[surface]} {...props} />;
}
