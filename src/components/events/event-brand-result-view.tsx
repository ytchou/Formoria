"use client";

import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { BrandCard } from "@/components/brands/brand-card";
import {
  MASONRY_ABOVE_FOLD,
  MasonryGrid,
} from "@/components/brands/masonry-grid";
import { ViewItemListTracker } from "@/components/analytics/view-item-list-tracker";
import { Button } from "@/components/ui/button";
import { SavedBrandsProvider } from "@/hooks/use-saved-brands";
import type {
  EventBrandEntry,
  LinkedEventExhibitorEntry,
} from "@/lib/services/events";

// Four rows of the grid's widest column count. Keeping the cap next to the
// MasonryGrid constant means the server-visible links and preload decisions
// continue to share one source of truth.
export const EVENT_LINEUP_VISIBLE_CAP = 4 * MASONRY_ABOVE_FOLD;

export type EventBrandResultViewProps = {
  entries: readonly (EventBrandEntry | LinkedEventExhibitorEntry)[];
  eventSlug: string;
  locale: string;
  expanded: boolean;
  hiddenCount: number;
  onExpand: () => void;
  compact?: boolean;
  itemCount?: number;
  creativeExpo?: boolean;
  renderTracker?: boolean;
  onBoothHover?: (booth: string | null) => void;
};

/**
 * Controlled result rendering shared by legacy event lineups and the Creative
 * Expo explorer. Filtering and state stay with each surface; cards, tracking,
 * reveal behavior, and the server-rendered links stay identical.
 */
export function EventBrandResultView({
  entries,
  eventSlug,
  locale,
  expanded,
  hiddenCount,
  onExpand,
  compact = false,
  itemCount,
  creativeExpo = false,
  renderTracker = true,
  onBoothHover,
}: EventBrandResultViewProps) {
  const t = useTranslations("events");
  const isEnglish = locale === "en";

  return (
    <SavedBrandsProvider>
      {renderTracker ? (
        <ViewItemListTracker
          listName={`event:${eventSlug}`}
          itemCount={itemCount ?? entries.length}
        />
      ) : null}
      <MasonryGrid
        compact={compact}
        visibleCount={expanded ? undefined : EVENT_LINEUP_VISIBLE_CAP}
      >
        {entries.map((entry, index) => {
          const area = isEnglish ? (entry.areaEn ?? entry.area) : entry.area;
          const creativeEntry = creativeExpo && "zone" in entry ? entry : null;
          const boothNote = creativeEntry?.booth
            ? `${t("boothLabel")}: ${creativeEntry.booth}`
            : undefined;

          const card = (
            <BrandCard
              brand={entry.brand}
              variant="editorial"
              eyebrow={creativeEntry?.zone ?? entry.booth ?? area ?? undefined}
              note={
                boothNote ??
                ("note" in entry
                  ? ((isEnglish ? (entry.noteEn ?? entry.note) : entry.note) ??
                    undefined)
                  : undefined)
              }
              preload={index < MASONRY_ABOVE_FOLD}
              position={index}
            />
          );
          // The wrapper exists only to report booth hover back to the floor
          // map. `BrandCard` and `MasonryGrid` are shared with /brands, so the
          // legacy lineup keeps its exact DOM by skipping the wrapper entirely.
          if (!onBoothHover || !creativeEntry) {
            return <Fragment key={entry.brand.id}>{card}</Fragment>;
          }

          return (
            <div
              key={entry.brand.id}
              onBlur={() => onBoothHover(null)}
              onFocus={() => onBoothHover(creativeEntry.booth)}
              onMouseEnter={() => onBoothHover(creativeEntry.booth)}
              onMouseLeave={() => onBoothHover(null)}
            >
              {card}
            </div>
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
