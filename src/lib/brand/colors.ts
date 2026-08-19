// Ink & Paper palette for next/og image routes, which cannot import CSS tokens.
// Mirrors the docs/designs/ux/DESIGN.md front-matter values:
//   bg -> canvas, fg/primary -> ink, cta -> the single accent, espresso -> muted.
// The `cta` KEY is v1 naming kept for its callers; its VALUE is the v2 accent.
// `primary` intentionally equals `fg`: hierarchy comes from weight and scale, not colour.
export const brand = {
  bg: "#FDFCFA",
  fg: "#18181B",
  primary: "#18181B",
  cta: "#2F4F63",
  espresso: "#6B6B6B",
} as const;
