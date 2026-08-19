import type { ReactNode } from "react";

import { Grid } from "@/components/ui/grid";

type BrandRowProps = {
  /**
   * The row's cards, authored as plain `<BrandCard slug="…" />` shortcodes.
   *
   * Children, never a `slugs` array: MDX expression attributes (`slugs={[…]}`)
   * are silently dropped by the story pipeline (DEV-1302), so an array prop
   * would arrive `undefined` at runtime — that is exactly what broke
   * `BrandGrid`. Children pass through intact, which is also what let the
   * retired `BrandSpotlight` carry its prose. Do not add an array prop.
   */
  children?: ReactNode;
};

/**
 * `<BrandRow>…</BrandRow>` inside story MDX: three brand cards for one
 * category section, in place of the retired one-brand `BrandSpotlight`.
 *
 * A layout wrapper and nothing else. It must not clone or inspect its children
 * — they are already-rendered `BrandCard` elements from the MDX map — so each
 * card can stretch to the full width of its responsive grid column without an
 * extra per-child wrapper element.
 *
 * Laid out by the shared grid primitive rather than a hand-written
 * `grid-cols-*` triple: the gutter is a token, so a change to it moves this row
 * and the directory together instead of leaving them 4px apart.
 */
export function BrandRow({ children }: BrandRowProps) {
  return (
    <Grid cols="thirds" className="my-10 w-full">
      {children}
    </Grid>
  );
}
