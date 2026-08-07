import type { CreativeExpoEntry } from "@/lib/services/events";
import {
  resolveExpoBoothZone,
  type ExpoZoneCode,
} from "@/components/events/taiwan-creative-expo-floor-map-config";
import { compareBoothNumbers } from "@/components/events/booth-sort";

/** The only canonical zones represented by the Creative Expo explorer. */
export const CREATIVE_EXPO_ZONE_CODES = ["K1", "K2", "K3", "S"] as const;

export type CreativeExpoZone = ExpoZoneCode;
export type CreativeExpoSort = "recommended" | "booth";

export type CreativeExpoExplorerState = {
  zone: CreativeExpoZone | null;
  query: string;
  page: number;
};

function isCreativeExpoZone(
  value: string | null | undefined,
): value is CreativeExpoZone {
  return (
    value !== null &&
    value !== undefined &&
    CREATIVE_EXPO_ZONE_CODES.includes(value as CreativeExpoZone)
  );
}

/**
 * Verifies the DEV-1371 booth-prefix resolver against canonical placement.
 * This is diagnostic consistency only: callers must continue using
 * `entry.zone` for filtering and highlighting.
 */
export function verifyCreativeExpoPlacement(
  entry: Pick<CreativeExpoEntry, "zone" | "booth">,
): {
  canonicalZone: CreativeExpoZone;
  boothZone: CreativeExpoZone | null;
  consistent: boolean;
} {
  const boothZone = resolveExpoBoothZone(entry.booth);
  return {
    canonicalZone: entry.zone,
    boothZone,
    consistent: boothZone === entry.zone,
  };
}

/**
 * Exhibitor fields come first because they exist for every row in the hall;
 * the brand projection is present on well under half of them, so leading with
 * it would order the array by a field that is usually absent.
 */
export function getCreativeExpoSearchFields(
  entry: Pick<CreativeExpoEntry, "name" | "nameEn" | "booth" | "brand">,
): string[] {
  return [
    entry.name,
    entry.nameEn,
    entry.booth,
    entry.brand?.name,
    entry.brand?.romanizedName,
    entry.brand?.slug,
  ].filter((value): value is string => Boolean(value?.trim()));
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

/** Applies query and zone filters with AND semantics. */
export function filterCreativeExpoEntries(
  entries: readonly CreativeExpoEntry[],
  state: Pick<CreativeExpoExplorerState, "zone" | "query">,
): CreativeExpoEntry[] {
  const query = normalizeQuery(state.query);

  return entries.filter((entry) => {
    if (state.zone !== null && entry.zone !== state.zone) return false;
    if (!query) return true;

    return getCreativeExpoSearchFields(entry).some((value) =>
      value.toLocaleLowerCase().includes(query),
    );
  });
}

/**
 * Sorts a filtered result without mutating the canonical/server order. The
 * recommended branch returns the original array so its identity stays useful
 * to memoized callers.
 */
export function sortCreativeExpoEntries(
  entries: readonly CreativeExpoEntry[],
  sort: CreativeExpoSort,
): CreativeExpoEntry[] {
  if (sort === "recommended") return entries as CreativeExpoEntry[];
  return [...entries].sort((left, right) =>
    compareBoothNumbers(left.booth, right.booth),
  );
}

/**
 * Returns a window into the sorted list rather than a slice: every row stays
 * rendered in the server HTML so crawlers still see the brand links on pages
 * nobody clicked, and the UI hides the out-of-window rows with CSS.
 * `page` is clamped on read so a filter that shrinks the result set can never
 * leave the list rendering an empty window, and `pageCount` never drops below
 * 1 so the empty state still has a valid page 1.
 */
export function paginateCreativeExpoEntries(
  entries: readonly unknown[],
  page: number,
  pageSize: number,
): { pageCount: number; startIndex: number; endIndex: number } {
  const size = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(entries.length / size));
  const safePage = Math.min(Math.max(Math.floor(page) || 1, 1), pageCount);
  const startIndex = (safePage - 1) * size;

  return {
    pageCount,
    startIndex,
    endIndex: Math.min(startIndex + size, entries.length),
  };
}

/** Counts each zone after query filtering and before selected-zone filtering. */
export function deriveCreativeExpoZoneCounts(
  entries: readonly CreativeExpoEntry[],
  state: Pick<CreativeExpoExplorerState, "query">,
): Record<CreativeExpoZone, number> {
  const counts = Object.fromEntries(
    CREATIVE_EXPO_ZONE_CODES.map((zone) => [zone, 0]),
  ) as Record<CreativeExpoZone, number>;
  const filtered = filterCreativeExpoEntries(entries, {
    query: state.query,
    zone: null,
  });

  for (const entry of filtered) counts[entry.zone] += 1;
  return counts;
}

export type CreativeExpoUrlState = {
  zone: CreativeExpoZone | null;
  query: string | null;
  page: number;
};

function parseCreativeExpoPage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  return Math.max(1, Number.parseInt(value, 10));
}

/** Reads only values present in the event's allowlists. */
export function parseCreativeExpoUrlState(
  params: Pick<URLSearchParams, "get">,
  allowedZones: readonly string[],
): CreativeExpoUrlState {
  const zone = params.get("zone");
  const booth = params.get("booth");

  return {
    zone:
      zone && allowedZones.includes(zone) && isCreativeExpoZone(zone)
        ? zone
        : null,
    // The interactive booth map is retired, but links shared from it are not.
    // A well-formed `?booth=` seeds the search box so those URLs still land on
    // the booth they named; `buildCreativeExpoUrl` then strips the param.
    query:
      booth && /^(K1|K2|K3|S)-\d+(-\d+)?$/.test(booth) ? booth : null,
    page: parseCreativeExpoPage(params.get("page")),
  };
}

/**
 * Mutates and returns a URL for `history.replaceState`; unrelated params/hash
 * survive. `booth` and `category` are deleted unconditionally so a URL shared
 * from the retired map self-cleans on the first interaction instead of
 * carrying a param nothing reads any more.
 */
export function buildCreativeExpoUrl(
  url: URL,
  state: Pick<CreativeExpoExplorerState, "zone" | "page">,
): URL {
  if (state.zone) url.searchParams.set("zone", state.zone);
  else url.searchParams.delete("zone");
  const page = Math.max(1, Math.floor(state.page) || 1);
  if (page > 1) url.searchParams.set("page", String(page));
  else url.searchParams.delete("page");
  url.searchParams.delete("booth");
  url.searchParams.delete("category");
  return url;
}

export function resetCreativeExpoFilters(
  state: CreativeExpoExplorerState,
): CreativeExpoExplorerState {
  return { ...state, zone: null, query: "", page: 1 };
}
