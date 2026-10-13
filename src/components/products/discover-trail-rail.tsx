import { ArrowRight } from "lucide-react";

import {
  TrailTile,
  type TrailTileLabels,
} from "@/components/landing/trail-tile";
import { actionLinkStyles } from "@/components/ui/action-link";
import { gridStyles } from "@/components/ui/grid";
import { Link } from "@/i18n/navigation";
import { routes } from "@/lib/routes";
import type { TrailCard } from "@/lib/trails/trail-card";

type DiscoverTrailRailProps = {
  /** Already trimmed by the caller (the page passes at most three). */
  trails: TrailCard[];
  heading: string;
  linkLabel: string;
  tileLabels: TrailTileLabels;
};

/**
 * The one editorial entry above /discover's unfiltered first page: a few
 * discovery trails, so the catalog opens on a selection with a stated
 * situation rather than on a bare grid.
 *
 * TrailTile has no compact variant, so this renders the existing card in the
 * shared three-column grid from `md`. Phones omit this section so it does
 * not push the first products away. No peek strip: the page makes no extra
 * read for it.
 */
export function DiscoverTrailRail({
  trails,
  heading,
  linkLabel,
  tileLabels,
}: DiscoverTrailRailProps) {
  if (trails.length === 0) return null;

  // From md only: on a phone the rail would push the first product below
  // two screens of trail cards (DS2-36 keeps results near the top).
  return (
    <section
      aria-labelledby="discover-trail-rail"
      className="hidden space-y-4 md:block"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="discover-trail-rail" className="type-card-title">
          {heading}
        </h2>
        <Link
          href={routes.style()}
          className={actionLinkStyles({ className: "ml-auto shrink-0" })}
        >
          {linkLabel}
          <ArrowRight aria-hidden="true" />
        </Link>
      </div>
      <ul className={gridStyles({ cols: "triptych" })}>
        {trails.map((trail, index) => (
          <TrailTile
            key={trail.slug}
            trail={trail}
            position={index}
            trailSurface="discover_trail_rail"
            headingLevel="h3"
            labels={tileLabels}
            className="min-w-0"
          />
        ))}
      </ul>
    </section>
  );
}
