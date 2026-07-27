// Ink & Paper palette for next/og image routes, which cannot import CSS tokens.
// Mirrors the docs/designs/ux/DESIGN.md front-matter values:
//   bg -> canvas, fg/primary -> ink, cta -> kiln (the single accent), espresso -> muted.
// `primary` intentionally equals `fg`: hierarchy comes from weight and scale, not colour.
export const brand = {
  bg: "#FDFCFA",
  fg: "#18181B",
  primary: "#18181B",
  cta: "#C04A24",
  espresso: "#6B6B6B",
} as const;
