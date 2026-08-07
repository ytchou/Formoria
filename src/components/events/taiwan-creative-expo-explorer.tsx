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
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ViewItemListTracker } from "@/components/analytics/view-item-list-tracker";
import type { CreativeExpoEntry } from "@/lib/services/events";
import {
  CREATIVE_EXPO_ZONE_CODES,
  buildCreativeExpoUrl,
  deriveCreativeExpoZoneCounts,
  filterCreativeExpoEntries,
  paginateCreativeExpoEntries,
  parseCreativeExpoUrlState,
  resetCreativeExpoFilters,
  sortCreativeExpoEntries,
  type CreativeExpoExplorerState,
  type CreativeExpoUrlState,
} from "@/lib/events/creative-expo-explorer";
import { EXPO_ZONE_DEFINITIONS } from "./taiwan-creative-expo-floor-map-config";
import { EventExhibitorList } from "./event-exhibitor-list";
import { EventExhibitorPagination } from "./event-exhibitor-pagination";

/** Rows per page. Every row still renders; the rest are hidden with CSS. */
const EXHIBITOR_PAGE_SIZE = 20;

type TaiwanCreativeExpoExplorerProps = {
  entries: readonly CreativeExpoEntry[];
  eventSlug: string;
  locale: string;
  rosterFailed?: boolean;
};

function ExplorerUrlSeed({
  onSeed,
}: {
  onSeed: (value: CreativeExpoUrlState) => void;
}) {
  const params = useSearchParams();
  const requestedZone = params.get("zone");
  const requestedBooth = params.get("booth");
  const requestedPage = params.get("page");

  useEffect(() => {
    onSeed(
      parseCreativeExpoUrlState(
        {
          get: (key: string) =>
            key === "zone"
              ? requestedZone
              : key === "booth"
                ? requestedBooth
                : key === "page"
                  ? requestedPage
                  : null,
        },
        CREATIVE_EXPO_ZONE_CODES,
      ),
    );
  }, [onSeed, requestedBooth, requestedPage, requestedZone]);

  return null;
}

export function TaiwanCreativeExpoExplorer({
  entries,
  eventSlug,
  locale,
  rosterFailed = false,
}: TaiwanCreativeExpoExplorerProps) {
  const t = useTranslations("events");
  const isEnglish = locale === "en";
  const [state, setState] = useState<CreativeExpoExplorerState>({
    zone: null,
    query: "",
    page: 1,
  });
  const listRef = useRef<HTMLUListElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);

  const syncUrl = useCallback((next: CreativeExpoExplorerState) => {
    if (typeof window === "undefined") return;
    const url = buildCreativeExpoUrl(new URL(window.location.href), next);
    const target = `${url.pathname}${url.search}${url.hash}`;
    // Only write when the URL actually changes. `query` is deliberately not
    // persisted, so on a page opened without any params every keystroke would
    // otherwise `replaceState` a byte-identical URL. Skip those: there is no
    // reason to rewrite the URL when nothing about it would change.
    if (
      target ===
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    ) {
      return;
    }
    window.history.replaceState(window.history.state, "", target);
  }, []);

  const seedUrlState = useCallback((value: CreativeExpoUrlState) => {
    setState((current) =>
      current.zone === value.zone &&
      current.page === value.page &&
      (value.query === null || current.query === value.query)
        ? current
        : {
            zone: value.zone,
            // `query` is only ever seeded from a legacy `?booth=` link; a null
            // means the URL said nothing about it, so the typed query stands.
            query: value.query ?? current.query,
            page: value.page,
          },
    );
  }, []);

  /**
   * The single funnel for every filter change. Force-setting `page: 1` here is
   * what guarantees a zone chip or a keystroke can never leave the reader on a
   * page number the new result set does not have.
   */
  const applyState = useCallback(
    (patch: Partial<Pick<CreativeExpoExplorerState, "zone" | "query">>) => {
      const next = { ...state, ...patch, page: 1 };
      setState(next);
      syncUrl(next);
    },
    [state, syncUrl],
  );

  const clearFilters = useCallback(() => {
    const next = resetCreativeExpoFilters(state);
    setState(next);
    syncUrl(next);
  }, [state, syncUrl]);

  const applyPage = useCallback(
    (page: number) => {
      const next = { ...state, page };
      setState(next);
      syncUrl(next);
      // Focus the list, never the clicked control: at either end that control
      // becomes a plain `<span>` and focus would be lost to `<body>`.
      listRef.current?.focus({ preventScroll: true });
      const reducedMotion =
        window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ===
        true;
      window.requestAnimationFrame(() =>
        filterBarRef.current?.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block: "start",
        }),
      );
    },
    [state, syncUrl],
  );

  const sortedEntries = useMemo(
    () =>
      sortCreativeExpoEntries(
        filterCreativeExpoEntries(entries, {
          zone: state.zone,
          query: state.query,
        }),
        "booth",
      ),
    [entries, state.query, state.zone],
  );
  const { pageCount, startIndex, endIndex } = useMemo(
    () =>
      paginateCreativeExpoEntries(
        sortedEntries,
        state.page,
        EXHIBITOR_PAGE_SIZE,
      ),
    [sortedEntries, state.page],
  );
  // Same clamp `paginateCreativeExpoEntries` applies internally, so the control
  // and the window it drives can never disagree.
  const currentPage = Math.min(Math.max(state.page, 1), pageCount);

  const zoneCounts = useMemo(
    () => deriveCreativeExpoZoneCounts(entries, { query: state.query }),
    [entries, state.query],
  );
  // Only zones actually present in the roster get a chip: the hall's zone list
  // is data, not configuration, and an always-zero chip is a dead end.
  const zoneOptions = useMemo(
    () =>
      EXPO_ZONE_DEFINITIONS.filter((definition) =>
        entries.some((entry) => entry.zone === definition.code),
      ).map((definition) => ({
        code: definition.code,
        label: isEnglish ? definition.names.en : definition.names.zhTW,
      })),
    [entries, isEnglish],
  );

  const isFiltered = state.zone !== null || state.query.trim() !== "";
  const isFilteredEmpty = sortedEntries.length === 0 && isFiltered;

  return (
    <section aria-labelledby="creative-expo-explorer" className="space-y-6">
      <Suspense fallback={null}>
        <ExplorerUrlSeed onSeed={seedUrlState} />
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

      <div className="space-y-4">
        <div ref={filterBarRef} className="space-y-4">
          <div className="relative w-full sm:max-w-xs">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              value={state.query}
              onChange={(event) => applyState({ query: event.target.value })}
              aria-label={t("explorerSearchAria")}
              placeholder={t("explorerSearchPlaceholder")}
              maxLength={100}
              className="w-full pl-9"
            />
          </div>

          {zoneOptions.length > 0 ? (
            <div
              role="group"
              aria-label={t("zoneFilterAria")}
              className="flex flex-wrap gap-2"
            >
              <ToggleChip
                size="default"
                pressed={state.zone === null}
                onPressedChange={() => applyState({ zone: null })}
              >
                {t("allZones")}
              </ToggleChip>
              {zoneOptions.map((option) => (
                <ToggleChip
                  key={option.code}
                  size="default"
                  pressed={state.zone === option.code}
                  onPressedChange={(pressed) =>
                    applyState({ zone: pressed ? option.code : null })
                  }
                >
                  {option.label}
                  <span className="tabular-nums opacity-70">
                    {zoneCounts[option.code]}
                  </span>
                </ToggleChip>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="type-caption">
              {isFiltered
                ? t("exhibitorCountFiltered", {
                    count: sortedEntries.length,
                    total: entries.length,
                  })
                : t("exhibitorCount", { count: sortedEntries.length })}
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
        </div>

        {rosterFailed ? null : entries.length === 0 ? (
          <p className="type-empty-body">{t("explorerRosterEmpty")}</p>
        ) : isFilteredEmpty ? (
          <EmptyState
            icon={<SearchX />}
            title={t("exhibitorEmptyTitle")}
            body={t("exhibitorEmptyBody")}
            action={
              <Button type="button" variant="secondary" onClick={clearFilters}>
                {t("clearFilters")}
              </Button>
            }
          />
        ) : (
          <>
            <EventExhibitorList
              entries={sortedEntries}
              eventSlug={eventSlug}
              startIndex={startIndex}
              endIndex={endIndex}
              listRef={listRef}
            />
            {/*
              Deliberately outside the `role="status"` count line above: folding
              the page position into that live region would re-announce it on
              every keystroke.
            */}
            {pageCount > 1 ? (
              <p className="mt-3 type-caption">
                {t("paginationPosition", { page: currentPage, pageCount })}
              </p>
            ) : null}
            <EventExhibitorPagination
              currentPage={currentPage}
              pageCount={pageCount}
              onPageChange={applyPage}
            />
          </>
        )}

        <ViewItemListTracker
          listName={`event:${eventSlug}`}
          itemCount={entries.length}
        />
      </div>

      {/*
        No provenance footer. The roster's verification date and the official
        exhibitor list live on `TaiwanCreativeExpoOfficialMap`, where they sit
        beside the map's own sources.
      */}
    </section>
  );
}
