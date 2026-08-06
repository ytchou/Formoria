"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Search, SearchX } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { EventCategoryOption } from "@/lib/services/events";
import {
  CREATIVE_EXPO_ZONE_CODES,
  buildCreativeExpoUrl,
  deriveCreativeExpoHighlightedZones,
  deriveCreativeExpoZoneCounts,
  filterCreativeExpoEntries,
  parseCreativeExpoUrlState,
  projectLinkedCreativeExpoEntries,
  resetCreativeExpoFilters,
  resetCreativeExpoZone,
  sortCreativeExpoEntries,
  type CreativeExpoExplorerState,
  type LinkedEventExhibitorEntry,
} from "@/lib/events/creative-expo-explorer";
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
  verifiedAt?: string | null;
  sourceUrl?: string | null;
};

function ExplorerUrlSeed({
  categoryOptions,
  onSeed,
}: {
  categoryOptions: readonly EventCategoryOption[];
  onSeed: (value: {
    zone: CreativeExpoExplorerState["zone"];
    category: string | null;
  }) => void;
}) {
  const params = useSearchParams();
  const requestedZone = params.get("zone");
  const requestedCategory = params.get("category");

  useEffect(() => {
    onSeed(
      parseCreativeExpoUrlState(
        {
          get: (key: string) =>
            key === "zone" ? requestedZone : requestedCategory,
        },
        CREATIVE_EXPO_ZONE_CODES,
        categoryOptions.map((option) => option.value),
      ),
    );
  }, [categoryOptions, onSeed, requestedCategory, requestedZone]);

  return null;
}

export function TaiwanCreativeExpoExplorer({
  entries,
  categoryOptions,
  eventSlug,
  locale,
  rosterFailed = false,
  verifiedAt = null,
  sourceUrl = null,
}: TaiwanCreativeExpoExplorerProps) {
  const t = useTranslations("events");
  const [state, setState] = useState<CreativeExpoExplorerState>({
    zone: null,
    category: null,
    query: "",
    sort: "recommended",
    expanded: false,
    mobilePanel: "map",
  });

  const syncUrl = useCallback(
    (zone: CreativeExpoExplorerState["zone"], category: string | null) => {
      if (typeof window === "undefined") return;
      const url = buildCreativeExpoUrl(new URL(window.location.href), {
        zone,
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
      category: string | null;
    }) => {
      setState((current) =>
        current.zone === value.zone && current.category === value.category
          ? current
          : { ...current, zone: value.zone, category: value.category },
      );
    },
    [],
  );

  const applyZone = useCallback(
    (zone: CreativeExpoExplorerState["zone"]) => {
      setState((current) => ({ ...current, zone }));
      syncUrl(zone, state.category);
    },
    [state.category, syncUrl],
  );

  const applyCategory = useCallback(
    (category: string | null) => {
      setState((current) => ({ ...current, category }));
      syncUrl(state.zone, category);
    },
    [state.zone, syncUrl],
  );

  const clearFilters = useCallback(() => {
    setState((current) => resetCreativeExpoFilters(current));
    syncUrl(null, null);
  }, [syncUrl]);

  const resetMap = useCallback(() => {
    setState((current) => resetCreativeExpoZone(current));
    syncUrl(null, state.category);
  }, [state.category, syncUrl]);

  const filteredEntries = useMemo(
    () => filterCreativeExpoEntries(entries, state),
    [entries, state],
  );
  const sortedEntries = useMemo(
    () => sortCreativeExpoEntries(filteredEntries, state.sort),
    [filteredEntries, state.sort],
  );
  const projectedEntries = useMemo(
    () => projectLinkedCreativeExpoEntries(sortedEntries),
    [sortedEntries],
  );
  const zoneCounts = useMemo(
    () => deriveCreativeExpoZoneCounts(entries, state),
    [entries, state],
  );
  const highlightedZones = useMemo(
    () => deriveCreativeExpoHighlightedZones(entries, state),
    [entries, state],
  );
  const isFiltered =
    state.zone !== null || state.category !== null || state.query.trim() !== "";
  const isFilteredEmpty = sortedEntries.length === 0 && isFiltered;
  const hiddenCount = state.expanded
    ? 0
    : Math.max(sortedEntries.length - EVENT_LINEUP_VISIBLE_CAP, 0);

  return (
    <section aria-labelledby="creative-expo-explorer" className="space-y-6">
      <Suspense fallback={null}>
        <ExplorerUrlSeed
          categoryOptions={categoryOptions}
          onSeed={seedUrlState}
        />
      </Suspense>

      <header className="space-y-2">
        <h2 id="creative-expo-explorer" className="type-section-title">
          {t("explorerHeading")}
        </h2>
        <p className="max-w-3xl type-section-description">
          {t("explorerDescription")}
        </p>
        <p className="type-caption">{t("explorerDisclosure")}</p>
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
        role="tablist"
        aria-label={t("explorerMobilePanels")}
      >
        <Button
          type="button"
          role="tab"
          aria-selected={state.mobilePanel === "map"}
          variant={state.mobilePanel === "map" ? "primary" : "secondary"}
          onClick={() =>
            setState((current) => ({ ...current, mobilePanel: "map" }))
          }
        >
          {t("explorerMapPanel")}
        </Button>
        <Button
          type="button"
          role="tab"
          aria-selected={state.mobilePanel === "list"}
          variant={state.mobilePanel === "list" ? "primary" : "secondary"}
          onClick={() =>
            setState((current) => ({ ...current, mobilePanel: "list" }))
          }
        >
          {t("explorerListPanel")}
        </Button>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <div
          className={
            state.mobilePanel === "map"
              ? "block lg:sticky lg:top-6 lg:self-start"
              : "hidden lg:sticky lg:top-6 lg:block lg:self-start"
          }
        >
          <TaiwanCreativeExpoFloorMap
            highlightedZones={highlightedZones}
            onReset={resetMap}
            onZoneSelect={applyZone}
            selectedZone={state.zone}
            zoneCounts={zoneCounts}
          />
        </div>

        <div
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
                  size="chip"
                  pressed={state.category === null}
                  onPressedChange={() => applyCategory(null)}
                >
                  {t("allCategories")}
                </ToggleChip>
                {categoryOptions.map((option) => (
                  <ToggleChip
                    key={option.value}
                    size="chip"
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
                  {t("clearFilters")}
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
                    {t("clearFilters")}
                  </Button>
                }
              />
            ) : (
              <EventBrandResultView
                entries={projectedEntries}
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
              />
            )}
          </div>
        </div>
      </div>

      {verifiedAt || sourceUrl ? (
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 type-caption">
          {verifiedAt ? (
            <span>{t("explorerVerifiedAt", { date: verifiedAt })}</span>
          ) : null}
          {sourceUrl ? (
            <a
              className="type-link"
              href={sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              {t("explorerSource")}
            </a>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}
