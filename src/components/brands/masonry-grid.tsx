import { Children, type ReactNode } from "react";
import { Grid } from "@/components/ui/grid";

interface MasonryGridProps {
  children: ReactNode;
  /**
   * Caps how many cards are VISIBLE, never how many are rendered: everything
   * past the cap keeps its markup and is hidden with CSS. Slicing the list
   * instead would drop those cards out of the server HTML, and on the event
   * lineup that HTML is the crawlable substance of the page. Unset means every
   * card shows, which is what `/brands` wants.
   */
  visibleCount?: number;
  /**
   * Uses a compact semantic `<ul>/<li>` wrapper for dense result surfaces.
   * The default remains the directory's existing role-based `<div>` layout.
   */
  compact?: boolean;
}

export function MasonryGrid({
  children,
  visibleCount,
  compact = false,
}: MasonryGridProps) {
  // Cards render present: no scroll reveal (DESIGN §7b, "never on scroll").
  const items = Children.map(children, (child, i) => {
    const hidden = visibleCount !== undefined && i >= visibleCount;
    const className = hidden ? "hidden" : undefined;

    return compact ? (
      <li key={i} className={className}>
        {child}
      </li>
    ) : (
      <div key={i} role="listitem" className={className}>
        {child}
      </div>
    );
  });

  return compact ? (
    <Grid as="ul" cols="thirds">
      {items}
    </Grid>
  ) : (
    <Grid cols="thirds" role="list">
      {items}
    </Grid>
  );
}
