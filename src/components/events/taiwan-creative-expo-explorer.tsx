"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, SearchX } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ViewItemListTracker } from "@/components/analytics/view-item-list-tracker";
import type {
  EventCategoryOption,
  LinkedEventExhibitorEntry,
} from "@/lib/services/events";
import {
  CREATIVE_EXPO_ZONE_CODES,
  buildCreativeExpoUrl,
  deriveCreativeExpoHighlightedZones,
  deriveCreativeExpoZoneCounts,
  filterCreativeExpoEntries,
  parseCreativeExpoUrlState,
  resetCreativeExpoFilters,
  resetCreativeExpoZone,
  sortCreativeExpoEntries,
  type CreativeExpoExplorerState,
} from "@/lib/events/creative-expo-explorer";
import { trackBoothSelected } from "@/lib/analytics";
import geometry from "../../../content/events/2026-taiwan-creative-expo.block-geometry.json";
import { TaiwanCreativeExpoFloorMap } from "./taiwan-creative-expo-floor-map";
import {
  EventBrandResultView,
  EVENT_LINEUP_VISIBLE_CAP,
} from "./event-brand-result-view";

type TaiwanCreativeExpoExplorerProps = {
  entries: readonly LinkedEventExhibitorEntry[];
  categoryOptions: readonly EventCategoryOption[];
  eventSlug: string;
  locale: string;
  rosterFailed?: boolean;
};

function ExplorerUrlSeed({
  categoryOptions,
  allowedBooths,
  onSeed,
}: {
  categoryOptions: readonly EventCategoryOption[];
  allowedBooths: readonly string[];
  onSeed: (value: {
    zone: CreativeExpoExplorerState["zone"];
    booth: string | null;
    category: string | null;
  }) => void;
}) {
  const params = useSearchParams();
  const requestedZone = params.get("zone");
  const requestedCategory = params.get("category");
  const requestedBooth = params.get("booth");

  useEffect(() => {
    onSeed(
      parseCreativeExpoUrlState(
        {
          get: (key: string) =>
            key === "zone"
              ? requestedZone
              : key === "booth"
                ? requestedBooth
                : requestedCategory,
        },
        CREATIVE_EXPO_ZONE_CODES,
        categoryOptions.map((option) => option.value),
        allowedBooths,
      ),
    );
  }, [
    allowedBooths,
    categoryOptions,
    onSeed,
    requestedBooth,
    requestedCategory,
    requestedZone,
  ]);

  return null;
}

export function TaiwanCreativeExpoExplorer({
  entries,
  categoryOptions,
  eventSlug,
  locale,
  rosterFailed = false,
}: TaiwanCreativeExpoExplorerProps) {
  const t = useTranslations("events");
  const [state, setState] = useState<CreativeExpoExplorerState>({
    zone: null,
    booth: null,
    category: null,
    query: "",
    sort: "recommended",
    expanded: false,
    mobilePanel: "map",
  });
  const [hoveredBooth, setHoveredBooth] = useState<string | null>(null);
  const rosterRef = useRef<HTMLDivElement>(null);
  const boothAllowlist = useMemo(
    () => [
      ...entries
        .map((entry) => entry.booth)
        .filter((booth): booth is string => Boolean(booth)),
      ...geometry.blocks.map((block) => block.block),
    ],
    [entries],
  );

  const syncUrl = useCallback(
    (
      zone: CreativeExpoExplorerState["zone"],
      category: string | null,
      booth: string | null,
    ) => {
      if (typeof window === "undefined") return;
      const url = buildCreativeExpoUrl(new URL(window.location.href), {
        zone,
        booth,
        category,
      });
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    },
    [],
  );

  const seedUrlState = useCallback(
    (value: {
      zone: CreativeExpoExplorerState["zone"];
      booth: string | null;
      category: string | null;
    }) => {
      setState((current) =>
        current.zone === value.zone &&
        current.booth === value.booth &&
        current.category === value.category
          ? current
          : {
              ...current,
              zone: value.zone,
              booth: value.booth,
              category: value.category,
            },
      );
    },
    [],
  );

  const applyZone = useCallback(
    (zone: CreativeExpoExplorerState["zone"]) => {
      setState((current) => ({ ...current, zone }));
      syncUrl(zone, state.category, state.booth);
    },
    [state.booth, state.category, syncUrl],
  );

  const applyCategory = useCallback(
    (category: string | null) => {
      setState((current) => ({ ...current, category }));
      syncUrl(state.zone, category, state.booth);
    },
    [state.booth, state.zone, syncUrl],
  );

  const clearFilters = useCallback(() => {
    setState((current) => resetCreativeExpoFilters(current));
    syncUrl(null, null, null);
  }, [syncUrl]);

  const resetMap = useCallback(() => {
    setState((current) => resetCreativeExpoZone(current));
    syncUrl(null, state.category, null);
  }, [state.category, syncUrl]);

  const applyBooth = useCallback(
    (
      booth: string,
      zone: CreativeExpoExplorerState["zone"],
      brandCount: number,
    ) => {
      // `mobilePanel` also flips to the roster: below `lg` the two panels are
      // exclusive, so scrolling to a `hidden` roster would be a no-op and the
      // booth selection would look like it did nothing. Desktop ignores it.
      setState((current) => ({
        ...current,
        booth,
        zone,
        mobilePanel: "list",
      }));
      syncUrl(zone, state.category, booth);
      trackBoothSelected(booth, zone ?? "", brandCount, eventSlug);
      const reducedMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ===
        true;
      window.requestAnimationFrame(() =>
        rosterRef.current?.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "start",
        }),
      );
    },
    [eventSlug, state.category, syncUrl],
  );

  const filteredEntries = useMemo(
    () => filterCreativeExpoEntries(entries, state),
    [entries, state],
  );
  const sortedEntries = useMemo(
    () => sortCreativeExpoEntries(filteredEntries, state.sort),
    [filteredEntries, state.sort],
  );
  const zoneCounts = useMemo(
    () => deriveCreativeExpoZoneCounts(entries, state),
    [entries, state],
  );
  const highlightedZones = useMemo(
    () => deriveCreativeExpoHighlightedZones(entries, state),
    [entries, state],
  );
  /**
   * Drives block dimming, so it deliberately ignores the booth filter: derived
   * from `filteredEntries` a booth selection would dim all 112 other blocks,
   * which reads as "no brands here" rather than "not the one you picked".
   */
  const visibleBooths = useMemo(
    () =>
      filterCreativeExpoEntries(entries, { ...state, booth: null })
        .map((entry) => entry.booth)
        .filter((booth): booth is string => Boolean(booth)),
    [entries, state],
  );
  const isFiltered =
    state.zone !== null ||
    state.booth !== null ||
    state.category !== null ||
    state.query.trim() !== "";
  const isFilteredEmpty = sortedEntries.length === 0 && isFiltered;
  const hiddenCount = state.expanded
    ? 0
    : Math.max(sortedEntries.length - EVENT_LINEUP_VISIBLE_CAP, 0);

  return (
    <section aria-labelledby="creative-expo-explorer" className="space-y-6">
      <Suspense fallback={null}>
        <ExplorerUrlSeed
          allowedBooths={boothAllowlist}
          categoryOptions={categoryOptions}
          onSeed={seedUrlState}
        />
      </Suspense>

      <header>
        <h2 id="creative-expo-explorer" className="type-section-title">
          {t("explorerHeading")}
        </h2>
      </header>

      {rosterFailed ? (
        <div
          className="rounded-xl border border-dashed border-warning/60 bg-warning/5 p-4"
          role="status"
        >
          <p className="type-card-title">{t("explorerRosterUnavailable")}</p>
          <p className="mt-1 type-card-description">
            {t("explorerRosterUnavailableBody")}
          </p>
        </div>
      ) : null}

      <div
        className="flex gap-2 lg:hidden"
        role="group"
        aria-label={t("explorerMobilePanels")}
      >
        <Button
          aria-pressed={state.mobilePanel === "map"}
          type="button"
          variant={state.mobilePanel === "map" ? "primary" : "secondary"}
          onClick={() =>
            setState((current) => ({ ...current, mobilePanel: "map" }))
          }
        >
          {t("explorerMapPanel")}
        </Button>
        <Button
          aria-pressed={state.mobilePanel === "list"}
          type="button"
          variant={state.mobilePanel === "list" ? "primary" : "secondary"}
          onClick={() =>
            setState((current) => ({ ...current, mobilePanel: "list" }))
          }
        >
          {t("explorerListPanel")}
        </Button>
      </div>

      {/*
        Stacked, not side by side: the map reads first at the container's full
        width and the roster it filters follows underneath.
      */}
      <div className="space-y-8">
        <div
          className={state.mobilePanel === "map" ? "block" : "hidden lg:block"}
        >
          <TaiwanCreativeExpoFloorMap
            highlightedZones={highlightedZones}
            onReset={resetMap}
            onZoneSelect={applyZone}
            selectedZone={state.zone}
            selectedBooth={state.booth}
            hoveredBooth={hoveredBooth}
            entries={entries}
            visibleBooths={visibleBooths}
            onBoothSelect={applyBooth}
            onBoothHover={setHoveredBooth}
            zoneCounts={zoneCounts}
          />
        </div>

        <div
          ref={rosterRef}
          className={state.mobilePanel === "list" ? "block" : "hidden lg:block"}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full sm:max-w-xs">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  value={state.query}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      query: event.target.value,
                    }))
                  }
                  aria-label={t("explorerSearchAria")}
                  placeholder={t("explorerSearchPlaceholder")}
                  maxLength={100}
                  className="w-full pl-9"
                />
              </div>
              <NativeSelect
                value={state.sort}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    sort: event.target
                      .value as CreativeExpoExplorerState["sort"],
                  }))
                }
                aria-label={t("explorerSortAria")}
                className="w-auto"
              >
                <option value="recommended">
                  {t("explorerSortRecommended")}
                </option>
                <option value="booth">{t("lineupSortBooth")}</option>
              </NativeSelect>
            </div>

            {categoryOptions.length > 0 ? (
              <div
                role="group"
                aria-label={t("categoryFilterAria")}
                className="flex flex-wrap gap-2"
              >
                <ToggleChip
                  size="default"
                  pressed={state.category === null}
                  onPressedChange={() => applyCategory(null)}
                >
                  {t("allCategories")}
                </ToggleChip>
                {categoryOptions.map((option) => (
                  <ToggleChip
                    key={option.value}
                    size="default"
                    pressed={state.category === option.value}
                    onPressedChange={(pressed) =>
                      applyCategory(pressed ? option.value : null)
                    }
                  >
                    {option.label}
                  </ToggleChip>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p role="status" className="type-caption">
                {isFiltered
                  ? t("brandCountFiltered", {
                      count: sortedEntries.length,
                      total: entries.length,
                    })
                  : t("brandCount", { count: sortedEntries.length })}
              </p>
              {isFiltered ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  onClick={clearFilters}
                >
                  {state.booth ? t("clearBoothFilter") : t("clearFilters")}
                </Button>
              ) : null}
            </div>

            {rosterFailed ? null : entries.length === 0 ? (
              <p className="type-empty-body">{t("explorerRosterEmpty")}</p>
            ) : isFilteredEmpty ? (
              <EmptyState
                icon={<SearchX />}
                title={
                  state.query.trim()
                    ? t("lineupSearchEmptyTitle")
                    : t("filteredEmptyTitle")
                }
                body={
                  state.query.trim()
                    ? t("lineupSearchEmptyBody")
                    : t("filteredEmptyBody")
                }
                action={
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={clearFilters}
                  >
                    {state.booth ? t("clearBoothFilter") : t("clearFilters")}
                  </Button>
                }
              />
            ) : (
              <EventBrandResultView
                entries={sortedEntries}
                eventSlug={eventSlug}
                locale={locale}
                expanded={state.expanded}
                hiddenCount={hiddenCount}
                itemCount={entries.length}
                onExpand={() =>
                  setState((current) => ({ ...current, expanded: true }))
                }
                compact
                creativeExpo
                renderTracker={false}
                onBoothHover={setHoveredBooth}
              />
            )}
            <ViewItemListTracker
              listName={`event:${eventSlug}`}
              itemCount={entries.length}
            />
          </div>
        </div>
      </div>

      {/*
        No provenance footer. The roster's verification date and the official
        exhibitor list moved up to `TaiwanCreativeExpoOfficialMap`, where they
        sit beside the map's own sources: both answer "where did this come
        from", and at the bottom of a 123-brand roster they were 4,800px down
        the page, which is nowhere.
      */}
    </section>
  );
}
