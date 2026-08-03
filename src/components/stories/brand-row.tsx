import type { ReactNode } from "react";

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
 * The grid is one column on mobile, two at `sm`, and three at `md`, keeping
 * brand rows aligned with the story article container at every breakpoint.
 */
export function BrandRow({ children }: BrandRowProps) {
  return (
    <div className="my-10 grid w-full grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
      {children}
    </div>
  );
}
