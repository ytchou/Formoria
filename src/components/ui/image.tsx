import NextImage, { type ImageProps as NextImageProps } from "next/image";

import { MEASURE_PX } from "@/lib/constants/layout";

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
 * NOTHING IS DERIVED BY OMISSION. That is the whole mechanism: a card and a
 * hero cannot end up sharing one string because a caller left the question
 * open. Naming a `surface` answers it from the vocabulary; spelling an explicit
 * `sizes` answers it for a box the vocabulary does not describe. Answering
 * neither is a type error.
 *
 * A one-off box states ONLY its measurement. It used to have to name a surface
 * as well, and every one of them picked `thumb` — a 448px admin hero preview
 * and a 176px grid cell both declared themselves thumbnails and then overrode
 * the hint anyway, so the word carried no information at exactly the sites the
 * vocabulary was meant to keep honest.
 *
 * `alt` stays required, exactly as `next/image` declares it. Decorative images
 * pass `alt=""` — an explicit statement that the image carries no information —
 * and informative ones describe what the image conveys. Making `alt` optional
 * would let a missing description read as a decorative one.
 */
export const IMAGE_SURFACE_SIZES = {
  /** Full-bleed band: page hero, section backdrop. */
  hero: "100vw",
  /**
   * Content-column image capped at the page measure — a trail hero, the expo
   * floor map, a story hero.
   *
   * THE NUMBER COMES FROM `MEASURE_PX`, NOT FROM THIS FILE. It read a literal
   * `1280px` until DEV-1529, which was the 80rem measure of the day arrived at
   * independently — so widening the measure would have left every banner
   * fetching a crop one size too small, with no test and no lint rule able to
   * see it. A `sizes` hint is parsed at build time and cannot read CSS, so the
   * measure must be written twice; `MEASURE_PX` is where the second copy is
   * anchored, and `check:design-tokens` fails if it and `globals.css` disagree.
   *
   * KNOWN, NOT FIXED, AND WORSE THAN IT WAS: this one hint serves two boxes
   * that now differ by roughly 2x. `EditorialHero` opens both the trail detail
   * route (~1472px of content at 1920px) and the story detail route (~688px,
   * because `/stories/[slug]` moved to `prose-measure` in DEV-1529) — and the
   * same ticket raised this hint from 1280px to 1600px, so the story hero
   * over-fetches more than before, not less. Sized for the larger box is the
   * deliberate direction: over-fetching costs bytes, under-fetching renders
   * soft.
   *
   * THERE IS NO PER-CALL ESCAPE HATCH TODAY. `EditorialHero` takes
   * `{ src, alt, className }` and passes `surface="banner"` itself, so neither
   * route can state its own box. Closing this means adding a `sizes` prop to
   * `EditorialHero` and threading it from the two routes — not a second
   * surface name that both routes would then have to keep straight.
   */
  banner: `(max-width: ${MEASURE_PX.page}px) 100vw, ${MEASURE_PX.page}px`,
  /** A cell of the four-up card grid. Mirrors `CARD_GRID_COLUMNS`. */
  card: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw",
  /** A cell of a three-up grid. */
  tile: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
  /** One half of a two-column split from `md` up. */
  split: "(max-width: 768px) 100vw, 50vw",
  /**
   * A small fixed square: the exhibitor row's 64/72px thumbnail. 72px, because
   * that is what the one box wearing this surface unoverridden measures — the
   * old 96px default described nothing on the page and every caller replaced it.
   */
  thumb: "72px",
} as const;

type ImageSurface = keyof typeof IMAGE_SURFACE_SIZES;

type BaseSurfaceImageProps = Omit<NextImageProps, "sizes" | "alt"> & {
  /** Which layout slot this image occupies. Drives `sizes`. */
  surface?: ImageSurface;
  /**
   * Required, and never inferred. `alt=""` for decorative; a description of
   * what the image conveys otherwise.
   */
  alt: string;
  /**
   * The box, measured, for a slot the vocabulary above does not describe — a
   * fixed-pixel admin preview, a share-card render, a printed floor map. It is
   * deliberately awkward: every use should carry a comment saying what the box
   * measures, because a measurement is a hint nothing else keeps honest.
   */
  sizes?: string;
};

export type SurfaceImageProps = BaseSurfaceImageProps &
  // Exactly one of the two answers, never neither: a named slot (which an
  // explicit `sizes` may still override for one crop of that slot), or a
  // measurement with no slot to name.
  ({ surface: ImageSurface } | { surface?: never; sizes: string });

export function SurfaceImage(props: SurfaceImageProps) {
  // Widened on the way in rather than destructured off the union: the body has
  // one shape, and the "one of the two" rule is the caller's contract, already
  // enforced above.
  const { surface, sizes, ...rest }: BaseSurfaceImageProps = props;

  return (
    <NextImage
      sizes={sizes ?? (surface ? IMAGE_SURFACE_SIZES[surface] : undefined)}
      {...rest}
    />
  );
}
