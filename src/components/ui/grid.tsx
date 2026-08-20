import type { ComponentPropsWithRef, ElementType, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * The card grid, written once.
 *
 * `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` was spelled out verbatim in six
 * files — the masonry grid, related brands, the directory skeleton, the shared
 * brand showcase, the dashboard quick actions, and favourites (page and
 * loading) — with FOUR different gap values between them. Nothing enforced
 * agreement, so a card grid and its own loading skeleton could disagree by 4px
 * and nobody would see it until both rendered on the same screen.
 *
 * Exported as a string as well as a component, so a surface that must keep its
 * own element (an existing `<ul>` with handlers, a masonry column wrapper) can
 * still read the one formula instead of copying it.
 */
export const CARD_GRID_COLUMNS = "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4";

export const gridStyles = cva("grid", {
  variants: {
    cols: {
      /** The default. Brand cards, product tiles, saved brands. */
      cards: CARD_GRID_COLUMNS,
      /** Two-up from `md`. Side-by-side prose or form blocks. */
      pair: "grid-cols-1 md:grid-cols-2",
      /** Three-up from `md`. Feature triplets, about cards. */
      triptych: "grid-cols-1 md:grid-cols-3",
      /** Three-up with a tablet stop. Microsite products, story galleries. */
      thirds: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
      /**
       * A filter rail beside its results, stacked below `lg`. Not a card grid:
       * this is the page shell the directory and its category routes are built
       * on, and the rail is a fixed measure because a filter list that reflows
       * with the viewport re-wraps its labels at every width.
       */
      sidebar: "grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)]",
    },
    /**
     * GAPS COME FROM `--space-gutter`, NEVER A NUMERIC STEP. `gap-gutter` is
     * generated from `--spacing-gutter: var(--space-gutter)` in `@theme
     * inline`, so changing the gutter moves every grid at once. `tight` is the
     * same token halved rather than a second, unrelated number.
     */
    gap: {
      gutter: "gap-gutter",
      tight: "gap-[calc(var(--space-gutter)/2)]",
      /*
       * NO `none`. It emitted no class at all — correct, since a grid's initial
       * `gap` is already zero — which made it indistinguishable in the DOM from
       * every other value, unobservable to any test, and callerless from the
       * day it was written. A gap variant that cannot be seen is not a token.
       */
    },
  },
  defaultVariants: {
    cols: "cards",
    gap: "gutter",
  },
});

export type GridProps<T extends ElementType = "div"> = VariantProps<
  typeof gridStyles
> &
  // WithRef, not WithoutRef: two callers measure the grid element (the masonry
  // reveal observer, the showcase in-view observer). React 19 passes `ref`
  // through as an ordinary prop, so no `forwardRef` wrapper is needed — but the
  // type has to admit it or those call sites do not compile.
  Omit<ComponentPropsWithRef<T>, "children" | "className"> & {
    /**
     * The element to render. A list of things is a `<ul>`; the default `<div>`
     * is for a grid whose children are not a list. Semantics stay the caller's
     * decision because only the caller knows what the cells mean.
     */
    as?: T;
    children?: ReactNode;
    className?: string;
  };

export function Grid<T extends ElementType = "div">({
  as,
  className,
  cols,
  gap,
  ...props
}: GridProps<T>) {
  const Component = (as ?? "div") as ElementType;

  return (
    <Component className={cn(gridStyles({ cols, gap }), className)} {...props} />
  );
}
