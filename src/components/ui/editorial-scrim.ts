/**
 * THE EDITORIAL SCRIM — one eased gradient behind copy set over a photograph.
 *
 * The trail tile and the trail hero each stacked two scrims: a near-opaque
 * copy block (`from-ink/90 to-ink/80`) plus an absolutely positioned 48–96px
 * linear fade above it. The joins showed as three horizontal band seams
 * (EL-07). This is one gradient, interpolated in `oklab`, that runs from
 * ink/92 at the foot to ink/82 ten rem from the top of the copy block, then
 * eases out to transparent over the last ten rem.
 *
 * Render it as ONE layer, `cn(editorialScrimLayer, editorialScrim)` on an
 * `aria-hidden` span inside the (relative) copy block, with the copy above it.
 * The layer starts 10rem (12rem from md) above the copy, so the fade has its
 * runway and every text line still sits on ink/82 or darker. It is absolutely
 * positioned, not padding, so it never grows a band past its aspect box
 * (DESIGN.md §8 TrailCard). On-ink text over ink/82 on pure white measures
 * ≥ 5.8:1 (§8: "a gradient scrim concentrated behind the copy").
 *
 * Tailwind reads these literals at build time, so they stay whole strings.
 */
export const editorialScrim =
  "bg-[linear-gradient(in_oklab_to_top,color-mix(in_oklab,var(--ink)_92%,transparent)_0%,color-mix(in_oklab,var(--ink)_82%,transparent)_calc(100%-10rem),color-mix(in_oklab,var(--ink)_55%,transparent)_calc(100%-6rem),color-mix(in_oklab,var(--ink)_22%,transparent)_calc(100%-3rem),transparent_100%)]";

/** Position of the scrim layer: the copy block plus the fade's runway above it. */
export const editorialScrimLayer =
  "pointer-events-none absolute inset-x-0 bottom-0 -top-40 md:-top-48";
