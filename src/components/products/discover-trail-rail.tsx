import { ArrowRight } from "lucide-react";

import { TrailSnapRow } from "@/components/landing/trail-snap-row";
import { TrailTile, type TrailTileLabels } from "@/components/landing/trail-tile";
import { actionLinkStyles } from "@/components/ui/action-link";
import { gridStyles } from "@/components/ui/grid";
import { Link } from "@/i18n/navigation";
import { routes } from "@/lib/routes";
import type { TrailCard } from "@/lib/trails/trail-card";
import { cn } from "@/lib/utils";

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
 * homepage's row geometry: a native snap-scroll row below `md` (with its
 * 「1 / n」 counter), three-up from `md`. The row's padding inside a matching
 * negative margin keeps the cards' focus ring inside the scroll clip. No peek
 * strip: the page makes no extra read for it.
 */
export function DiscoverTrailRail({
  trails,
  heading,
  linkLabel,
  tileLabels,
}: DiscoverTrailRailProps) {
  if (trails.length === 0) return null;

  return (
    <section aria-labelledby="discover-trail-rail" className="space-y-4">
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
      <TrailSnapRow
        count={trails.length}
        className={cn(
          gridStyles({ cols: "triptych" }),
          "-mx-1.5 flex snap-x snap-mandatory overflow-x-auto p-1.5 md:mx-0 md:grid md:snap-none md:overflow-visible md:p-0",
        )}
      >
        {trails.map((trail, index) => (
          <TrailTile
            key={trail.slug}
            trail={trail}
            position={index}
            trailSurface="discover_trail_rail"
            headingLevel="h3"
            labels={tileLabels}
            className="min-w-0 shrink-0 basis-[82%] snap-start scroll-mx-1.5 md:basis-auto"
          />
        ))}
      </TrailSnapRow>
    </section>
  );
}
