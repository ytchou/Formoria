import type { LinkedEventExhibitorEntry } from "@/lib/services/events";
import { resolveProductTypeSlug } from "@/lib/brands/category-label";
import {
  resolveExpoBoothZone,
  type ExpoZoneCode,
} from "@/components/events/taiwan-creative-expo-floor-map-config";
import { compareBoothNumbers } from "@/components/events/booth-sort";

/** The only canonical zones represented by the Creative Expo explorer. */
export const CREATIVE_EXPO_ZONE_CODES = ["K1", "K2", "K3", "S"] as const;

export type CreativeExpoZone = ExpoZoneCode;
export type CreativeExpoSort = "recommended" | "booth";
type CreativeExpoMobilePanel = "map" | "list";

export type CreativeExpoExplorerState = {
  zone: CreativeExpoZone | null;
  booth: string | null;
  category: string | null;
  query: string;
  sort: CreativeExpoSort;
  expanded: boolean;
  mobilePanel: CreativeExpoMobilePanel;
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
  entry: Pick<LinkedEventExhibitorEntry, "zone" | "booth">,
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

/** Search fields intentionally include official roster names as well as the card projection. */
export function getCreativeExpoSearchFields(
  entry: Pick<LinkedEventExhibitorEntry, "name" | "nameEn" | "booth" | "brand">,
): string[] {
  return [
    entry.brand.name,
    entry.brand.romanizedName,
    entry.name,
    entry.nameEn,
    entry.booth,
    entry.brand.slug,
  ].filter((value): value is string => Boolean(value?.trim()));
}

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

/** Applies category, query, and zone filters with AND semantics. */
export function filterCreativeExpoEntries(
  entries: readonly LinkedEventExhibitorEntry[],
  state: Pick<
    CreativeExpoExplorerState,
    "zone" | "booth" | "category" | "query"
  >,
): LinkedEventExhibitorEntry[] {
  const query = normalizeQuery(state.query);

  return entries.filter((entry) => {
    if (state.zone !== null && entry.zone !== state.zone) return false;
    if (
      state.booth !== null &&
      entry.booth !== state.booth &&
      !(entry.booth?.startsWith(`${state.booth}-`) ?? false)
    )
      return false;
    if (state.category !== null && entry.brand.category !== state.category)
      return false;
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
  entries: readonly LinkedEventExhibitorEntry[],
  sort: CreativeExpoSort,
): LinkedEventExhibitorEntry[] {
  if (sort === "recommended") return entries as LinkedEventExhibitorEntry[];
  return [...entries].sort((left, right) =>
    compareBoothNumbers(left.booth, right.booth),
  );
}

/** Counts each zone after category/query filtering and before selected-zone filtering. */
export function deriveCreativeExpoZoneCounts(
  entries: readonly LinkedEventExhibitorEntry[],
  state: Pick<CreativeExpoExplorerState, "category" | "query">,
): Record<CreativeExpoZone, number>;
export function deriveCreativeExpoZoneCounts(
  entries: readonly LinkedEventExhibitorEntry[],
  state: Pick<CreativeExpoExplorerState, "zone" | "category" | "query">,
): Record<CreativeExpoZone, number>;
export function deriveCreativeExpoZoneCounts(
  entries: readonly LinkedEventExhibitorEntry[],
  state: Pick<CreativeExpoExplorerState, "category" | "query">,
): Record<CreativeExpoZone, number> {
  const counts = Object.fromEntries(
    CREATIVE_EXPO_ZONE_CODES.map((zone) => [zone, 0]),
  ) as Record<CreativeExpoZone, number>;
  const filtered = filterCreativeExpoEntries(entries, {
    ...state,
    zone: null,
    booth: null,
  });

  for (const entry of filtered) counts[entry.zone] += 1;
  return counts;
}

/** Highlights represented zones when no zone is selected; selection wins. */
export function deriveCreativeExpoHighlightedZones(
  entries: readonly LinkedEventExhibitorEntry[],
  state: Pick<CreativeExpoExplorerState, "zone" | "category" | "query">,
): CreativeExpoZone[] {
  if (state.zone !== null) return [];

  const represented = new Set(
    filterCreativeExpoEntries(entries, {
      ...state,
      zone: null,
      booth: null,
    }).map((entry) => entry.zone),
  );
  return CREATIVE_EXPO_ZONE_CODES.filter((zone) => represented.has(zone));
}

export type CreativeExpoUrlState = {
  zone: CreativeExpoZone | null;
  booth: string | null;
  category: string | null;
};

function resolveAllowedCreativeExpoCategory(
  value: string | null,
  allowedCategories: readonly string[],
): string | null {
  if (!value) return null;

  const exactMatch = allowedCategories.find((option) => option === value);
  if (exactMatch) return exactMatch;

  const canonicalSlug = resolveProductTypeSlug(value);
  if (!canonicalSlug) return null;

  return (
    allowedCategories.find(
      (option) => resolveProductTypeSlug(option) === canonicalSlug,
    ) ?? null
  );
}

/** Reads only values present in the event's allowlists; query is transient. */
export function parseCreativeExpoUrlState(
  params: Pick<URLSearchParams, "get">,
  allowedZones: readonly string[],
  allowedCategories: readonly string[],
  allowedBooths: readonly string[] = [],
): CreativeExpoUrlState {
  const zone = params.get("zone");
  const booth = params.get("booth");
  const category = params.get("category");
  return {
    zone:
      zone && allowedZones.includes(zone) && isCreativeExpoZone(zone)
        ? zone
        : null,
    booth:
      booth &&
      /^(K1|K2|K3|S)-\d+(-\d+)?$/.test(booth) &&
      allowedBooths.includes(booth)
        ? booth
        : null,
    category: resolveAllowedCreativeExpoCategory(category, allowedCategories),
  };
}

/** Mutates and returns a URL for `history.replaceState`; unrelated params/hash survive. */
export function buildCreativeExpoUrl(
  url: URL,
  state: Pick<CreativeExpoUrlState, "zone" | "booth" | "category">,
): URL {
  if (state.zone) url.searchParams.set("zone", state.zone);
  else url.searchParams.delete("zone");
  const category = state.category
    ? (resolveProductTypeSlug(state.category) ?? state.category)
    : null;
  if (category) url.searchParams.set("category", category);
  else url.searchParams.delete("category");
  if (state.booth) url.searchParams.set("booth", state.booth);
  else url.searchParams.delete("booth");
  return url;
}

export function resetCreativeExpoFilters(
  state: CreativeExpoExplorerState,
): CreativeExpoExplorerState {
  return { ...state, zone: null, booth: null, category: null, query: "" };
}

/** Map reset is intentionally narrower than global clear. */
export function resetCreativeExpoZone(
  state: CreativeExpoExplorerState,
): CreativeExpoExplorerState {
  return { ...state, zone: null, booth: null };
}
