/**
 * The three page measures in pixels — the same numbers as the `rem` literals in
 * the `@utility` block in `src/app/globals.css`, at the 16px root.
 *
 *   page  100rem = 1600px
 *   form   64rem = 1024px
 *   prose  48rem =  768px
 *
 * THIS FILE EXISTS BECAUSE `next/image` CANNOT READ CSS. A `sizes` hint is
 * parsed at build time to pick which srcset entry the browser downloads, so it
 * has to be a static string; there is no point at which a stylesheet value is
 * available to it. The measure therefore has to be written twice, and the only
 * question is whether the second copy is anchored to the first.
 *
 * The consumer is `IMAGE_SURFACE_SIZES` in `src/components/ui/image.tsx`, whose
 * `banner` entry read `"(max-width: 1280px) 100vw, 1280px"` until Wave 4. That
 * 1280px WAS the 80rem content measure of the day, arrived at independently,
 * with nothing in either file mentioning the other — so widening the measure
 * would have left every banner image fetching a crop one size too small,
 * silently and invisibly. Removing that disconnect is the whole reason for this
 * constant, and `banner` is now built from `MEASURE_PX.page` rather than typed.
 *
 * The rem/px agreement is not left to this comment — `check:design-tokens`
 * parses the `@utility` declarations out of `globals.css` and fails the lint
 * chain if they and this map disagree.
 */
export const MEASURE_PX = {
  page: 1600,
  form: 1024,
  prose: 768,
} as const;

export type PageMeasure = keyof typeof MEASURE_PX;
