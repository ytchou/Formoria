"use client";

import { useTranslations } from "next-intl";
import { BrandCard } from "@/components/brands/brand-card";
import {
  MASONRY_ABOVE_FOLD,
  MasonryGrid,
} from "@/components/brands/masonry-grid";
import { ViewItemListTracker } from "@/components/analytics/view-item-list-tracker";
import { Button } from "@/components/ui/button";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import type { EventBrandEntry } from "@/lib/services/events";

// Four rows of the grid's widest column count. Keeping the cap next to the
// MasonryGrid constant means the server-visible links and preload decisions
// continue to share one source of truth.
export const EVENT_LINEUP_VISIBLE_CAP = 4 * MASONRY_ABOVE_FOLD;

export type EventBrandResultViewProps = {
  entries: readonly EventBrandEntry[];
  eventSlug: string;
  locale: string;
  expanded: boolean;
  hiddenCount: number;
  onExpand: () => void;
  itemCount?: number;
};

/**
 * Controlled result rendering for event lineups. Filtering and state stay with
 * `EventBrandGrid`; cards, tracking, reveal behavior, and the server-rendered
 * links stay here.
 *
 * The Creative Expo used to share this component; it now renders the whole hall
 * through `EventExhibitorList`, which is a dense list of possibly-unlisted
 * exhibitors rather than a grid of brand cards. The props that existed only for
 * that surface (`compact`, `creativeExpo`, `renderTracker`, `onBoothHover`) are
 * gone with it.
 */
export function EventBrandResultView({
  entries,
  eventSlug,
  locale,
  expanded,
  hiddenCount,
  onExpand,
  itemCount,
}: EventBrandResultViewProps) {
  const t = useTranslations("events");
  const isEnglish = locale === "en";

  return (
    <SavedBrandsProvider>
      <ViewItemListTracker
        listName={`event:${eventSlug}`}
        itemCount={itemCount ?? entries.length}
      />
      <MasonryGrid
        visibleCount={expanded ? undefined : EVENT_LINEUP_VISIBLE_CAP}
      >
        {entries.map((entry, index) => {
          const area = isEnglish ? (entry.areaEn ?? entry.area) : entry.area;

          return (
            <BrandCard
              key={entry.brand.id}
              brand={entry.brand}
              variant="editorial"
              eyebrow={entry.booth ?? area ?? undefined}
              note={
                (isEnglish ? (entry.noteEn ?? entry.note) : entry.note) ??
                undefined
              }
              preload={index < MASONRY_ABOVE_FOLD}
              position={index}
            />
          );
        })}
      </MasonryGrid>

      {hiddenCount > 0 ? (
        <div className="flex justify-center">
          <Button type="button" variant="secondary" onClick={onExpand}>
            {t("showAllBrands", { count: hiddenCount })}
          </Button>
        </div>
      ) : null}
    </SavedBrandsProvider>
  );
}
