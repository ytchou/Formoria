import { cache } from "react";

import type { AppLocale } from "@/i18n/locale-preference";
import type { Database } from "@/lib/supabase/database.types";
import type { Brand } from "@/lib/types";
import { getBrandCategoryLabel } from "@/lib/brands/category-label";
import { isoDateInTimeZone } from "@/lib/date-range";
import { createServiceClient } from "@/lib/supabase/server";
import { brandsBySlugsCacheKey, getBrandsBySlugs } from "./brands";

// ---------------------------------------------------------------------------
// Row + domain types
//
// snake_case → camelCase happens here and nowhere else: the DB columns are
// snake_case, every TS type downstream is camelCase, and the service boundary
// is the single place that translates (project convention).
// ---------------------------------------------------------------------------

export type EventRow = Database["public"]["Tables"]["events"]["Row"];

/**
 * Projection returned by the lineup query. Not the `event_brands` table row:
 * the query embeds `brands!inner(slug)` and `events!inner(...)`, and PostgREST
 * returns a to-one embed as an object (older stacks, and the array-shaped
 * to-many inference, hand back an array) — `eventBrandRowToDomain` accepts both.
 */
export type EventBrandJoinRow = {
  booth: string | null;
  area: string | null;
  area_en: string | null;
  note: string | null;
  note_en: string | null;
  sort_order: number;
  brands: { slug: string } | Array<{ slug: string }> | null;
};

/** Also the single source for the seed script's status validation. */
export const EVENT_STATUSES = ["draft", "published", "hidden"] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export type EventPhase = "upcoming" | "ongoing" | "past";

export type Event = {
  id: string;
  slug: string;
  name: string;
  nameEn: string | null;
  summary: string;
  summaryEn: string | null;
  description: string | null;
  descriptionEn: string | null;
  /** Taipei calendar date, `'YYYY-MM-DD'`. Never a `Date` — see `taipeiToday`. */
  startsOn: string;
  /** Taipei calendar date, `'YYYY-MM-DD'`, inclusive of the last day. */
  endsOn: string;
  venueName: string | null;
  venueNameEn: string | null;
  venueAddress: string | null;
  city: string | null;
  organizerName: string | null;
  officialUrl: string | null;
  ticketUrl: string | null;
  /** Tri-state: `true` free, `false` ticketed, `null` not yet known. */
  isFree: boolean | null;
  heroImageUrl: string | null;
  status: EventStatus;
  createdAt: string;
  updatedAt: string;
};

/** One lineup row before brand hydration: everything except the brand itself. */
export type EventBrandLink = {
  brandSlug: string;
  booth: string | null;
  area: string | null;
  areaEn: string | null;
  note: string | null;
  noteEn: string | null;
  sortOrder: number;
};

/** A lineup row with its brand resolved through the shared brand projection. */
export type EventBrandEntry = Omit<EventBrandLink, "brandSlug"> & {
  brand: Brand;
};

/**
 * `value` stays the zh area string in every locale so an `?area=` filter link
 * survives a locale switch; only `label` localizes.
 */
export type EventAreaOption = { value: string; label: string };

export type EventCategoryOption = { value: string; label: string };

export type EventsByPhase = {
  upcoming: Event[];
  ongoing: Event[];
  past: Event[];
};

// Kept as one string literal (not a concatenation) so supabase-js can infer the
// row shape from the generated types instead of falling back to `any`.
const EVENT_SELECT =
  "id, slug, name, name_en, summary, summary_en, description, description_en, starts_on, ends_on, venue_name, venue_name_en, venue_address, city, organizer_name, official_url, ticket_url, is_free, hero_image_url, status, created_at, updated_at";

/**
 * Resolves the event by slug inside the same round trip via an inner embed, so
 * this query has no dependency on `getPublishedEventBySlug` and the two can run
 * under a single `Promise.all` instead of serially.
 *
 * Only `brands!inner(slug)` is embedded. Selecting full brand rows here would
 * bypass `brandToDomain` and the `status = 'approved'` filter that
 * `getBrandsBySlugs` applies — a hidden or rejected brand would render on a
 * public event page.
 */
const EVENT_BRAND_SELECT =
  "booth, area, area_en, note, note_en, sort_order, brands!inner(slug), events!inner(slug, status)";

/**
 * The hub count has to agree with what the detail page renders: the detail page
 * hydrates through `getBrandsBySlugs`, which filters `status = 'approved'`, and
 * `composeEventBrands` then drops every unresolved slug. Counting raw join rows
 * advertises "12 brands" on a card whose grid announces 9. The embed is `!inner`
 * plus an explicit `brands.status` filter, matching `EVENT_BRAND_SELECT`.
 */
const EVENT_BRAND_COUNT_SELECT = "event_id, brands!inner(status)";

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const TAIPEI_TIME_ZONE = "Asia/Taipei";

/**
 * Today's Taipei calendar date as `'YYYY-MM-DD'`.
 *
 * `date` columns come back as `'YYYY-MM-DD'` strings and that is how they stay:
 * parsing one into a `Date` re-interprets a Taipei calendar day as UTC midnight,
 * which renders (and emits as schema.org `startDate`) one day early for every
 * reader west of Taipei. Zero-padded ISO dates also compare correctly with plain
 * `<` / `>`, so no arithmetic is needed anywhere in this module.
 *
 * `isoDateInTimeZone` takes a string; `toISOString()` round-trips the same
 * instant, so the Taipei calendar day is unchanged.
 */
export function taipeiToday(now: Date = new Date()): string {
  return isoDateInTimeZone(now.toISOString(), TAIPEI_TIME_ZONE);
}

/**
 * The last day is still `ongoing`: an event ending 8/9 runs all day on 8/9.
 * Hence `today > endsOn`, not `>=`.
 */
export function resolveEventPhase(
  event: Pick<Event, "startsOn" | "endsOn">,
  today: string = taipeiToday(),
): EventPhase {
  if (today < event.startsOn) return "upcoming";
  if (today > event.endsOn) return "past";
  return "ongoing";
}

/**
 * Upcoming and ongoing read forwards (soonest first — that is the next thing a
 * visitor can attend); past reads backwards from the most recently finished.
 */
export function partitionEventsByPhase(
  events: Event[],
  today: string = taipeiToday(),
): EventsByPhase {
  const byPhase: EventsByPhase = { upcoming: [], ongoing: [], past: [] };

  for (const event of events) {
    byPhase[resolveEventPhase(event, today)].push(event);
  }

  byPhase.upcoming.sort((a, b) => compareStrings(a.startsOn, b.startsOn));
  byPhase.ongoing.sort((a, b) => compareStrings(a.startsOn, b.startsOn));
  byPhase.past.sort((a, b) => compareStrings(b.endsOn, a.endsOn));

  return byPhase;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function toEventStatus(value: string): EventStatus {
  // Fails closed: an unrecognized status is treated as `draft` rather than
  // assumed publishable.
  return (EVENT_STATUSES as readonly string[]).includes(value)
    ? (value as EventStatus)
    : "draft";
}

export function eventRowToDomain(row: EventRow): Event {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    nameEn: row.name_en,
    summary: row.summary,
    summaryEn: row.summary_en,
    description: row.description,
    descriptionEn: row.description_en,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    venueName: row.venue_name,
    venueNameEn: row.venue_name_en,
    venueAddress: row.venue_address,
    city: row.city,
    organizerName: row.organizer_name,
    officialUrl: row.official_url,
    ticketUrl: row.ticket_url,
    isFree: row.is_free,
    heroImageUrl: row.hero_image_url,
    status: toEventStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Returns `null` when the embed carried no brand slug. `brands!inner` makes
 * that unreachable in practice, so this is a shape guard rather than a
 * business rule — the alternative is a crash on a malformed payload.
 */
export function eventBrandRowToDomain(
  row: EventBrandJoinRow,
): EventBrandLink | null {
  const embedded = Array.isArray(row.brands) ? row.brands[0] : row.brands;
  if (!embedded?.slug) return null;

  return {
    brandSlug: embedded.slug,
    booth: row.booth,
    area: row.area,
    areaEn: row.area_en,
    note: row.note,
    noteEn: row.note_en,
    sortOrder: row.sort_order,
  };
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Byte-order comparison rather than `localeCompare`: the result has to be
 * identical across runtimes and ICU versions, and this only ever breaks ties
 * within one `sortOrder` bucket.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Joins lineup rows to their hydrated brands.
 *
 * A slug missing from the map is dropped, not thrown on: brands get hidden,
 * rejected, or renamed after an event is curated, and one stale row must not
 * take down the whole event page. Ordering is `(sortOrder, brand.name)` with
 * `brand.slug` as a final tiebreak, so the same lineup renders in the same
 * order no matter what order the rows arrive in.
 */
export function composeEventBrands(
  links: EventBrandLink[],
  brandsBySlug: Map<string, Brand>,
): EventBrandEntry[] {
  const entries: EventBrandEntry[] = [];

  for (const link of links) {
    const brand = brandsBySlug.get(link.brandSlug);
    if (!brand) continue;

    entries.push({
      brand,
      booth: link.booth,
      area: link.area,
      areaEn: link.areaEn,
      note: link.note,
      noteEn: link.noteEn,
      sortOrder: link.sortOrder,
    });
  }

  return entries.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      compareStrings(a.brand.name, b.brand.name) ||
      compareStrings(a.brand.slug, b.brand.slug),
  );
}

/**
 * Distinct venue areas, sorted by their canonical (zh) value. Sorted rather
 * than left in lineup order because lineup order is keyed on brand name, which
 * would shuffle the filter chips whenever a brand is added. Rows with no area
 * are excluded rather than bucketed into an "other" option the filter UI would
 * have to special-case.
 */
export function deriveAreaOptions(
  entries: EventBrandEntry[],
  locale: AppLocale,
): EventAreaOption[] {
  const options = new Map<string, EventAreaOption>();

  for (const entry of entries) {
    if (!entry.area) continue;
    if (options.has(entry.area)) continue;

    options.set(entry.area, {
      value: entry.area,
      label: locale === "en" ? (entry.areaEn ?? entry.area) : entry.area,
    });
  }

  return [...options.values()].sort((a, b) => compareStrings(a.value, b.value));
}

/**
 * Distinct product categories, sorted by their canonical value for the same
 * reason `deriveAreaOptions` above is: lineup order is keyed on brand name, so
 * leaving the chips in that order reshuffles them whenever a brand is added.
 * Brands with no category are excluded rather than bucketed into an "other"
 * option the filter UI would have to special-case.
 */
export function deriveCategoryOptions(
  entries: EventBrandEntry[],
  locale: AppLocale,
): EventCategoryOption[] {
  const options = new Map<string, EventCategoryOption>();

  for (const entry of entries) {
    const category = entry.brand.category;
    if (!category) continue;
    if (options.has(category)) continue;

    // `getBrandCategoryLabel` returns "" for a category it cannot resolve;
    // falling back to the raw value keeps the chip readable instead of blank.
    const label = getBrandCategoryLabel(
      entry.brand,
      locale === "en" ? "en" : "zh-TW",
    );

    options.set(category, { value: category, label: label || category });
  }

  return [...options.values()].sort((a, b) => compareStrings(a.value, b.value));
}

// ---------------------------------------------------------------------------
// Queries
//
// Every query takes its client as the first argument and is exported on its
// own; `createServiceClient()` appears only inside the `cache()` wrappers at the
// bottom. That split is what lets the tests drive these with a query-builder
// double instead of mocking `@/lib/supabase/server`, which
// scripts/check-test-boundaries.mjs forbids.
//
// Error convention (matches brands.ts, deliberately not stories.ts): a query
// error is logged AND thrown, not swallowed into `[]`. The throw fails ISR
// regeneration so the last good page keeps being served; swallowing it would
// cache a degraded page for the full revalidation window with no signal
// anywhere. `null` means not-found, `[]` means genuinely empty.
// ---------------------------------------------------------------------------

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * PostgREST caps one response at `max_rows` (1000 — supabase/config.toml, and
 * the same on the hosted default) and returns the truncated page with HTTP 200:
 * `error` stays null, so the throw-on-error convention above never fires and the
 * caller silently sees a short list. Any read here that is not bounded by a
 * unique key therefore pages explicitly with `.range()`.
 */
const PAGE_SIZE = 1000;

type PageResult = { data: unknown; error: { message: string } | null };

/**
 * Runs `page(from, to)` until a short page comes back, concatenating the rows.
 * The caller's query must carry a total ordering, or a row can shift between
 * pages and be counted twice or missed.
 */
async function fetchAllPages<Row>(
  queryName: string,
  failure: string,
  page: (from: number, to: number) => PromiseLike<PageResult>,
): Promise<Row[]> {
  const collected: Row[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error(`${queryName} query error:`, error);
      throw new Error(`${failure}: ${error.message}`);
    }

    const rows = (data ?? []) as unknown as Row[];
    collected.push(...rows);
    if (rows.length < PAGE_SIZE) return collected;
  }
}

export async function fetchPublishedEvents(
  supabase: ServiceClient,
): Promise<Event[]> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("status", "published")
    // Matches the `(ends_on desc, starts_on desc) where status = 'published'`
    // partial index, so the hub query is index-only.
    .order("ends_on", { ascending: false })
    .order("starts_on", { ascending: false });

  if (error) {
    console.error("fetchPublishedEvents query error:", error);
    throw new Error(`Failed to fetch published events: ${error.message}`);
  }

  return ((data ?? []) as unknown as EventRow[]).map(eventRowToDomain);
}

export async function fetchPublishedEventBySlug(
  supabase: ServiceClient,
  slug: string,
): Promise<Event | null> {
  const { data, error } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (error) {
    console.error("fetchPublishedEventBySlug query error:", error);
    throw new Error(`Failed to fetch event ${slug}: ${error.message}`);
  }

  return data ? eventRowToDomain(data as unknown as EventRow) : null;
}

/**
 * Lineup rows for one published event slug, unhydrated. Resolving the event in
 * the same statement (via `events!inner`) is what lets the caller run this in
 * parallel with `getPublishedEventBySlug` rather than after it.
 */
export async function fetchEventBrandLinks(
  supabase: ServiceClient,
  slug: string,
): Promise<EventBrandLink[]> {
  const rows = await fetchAllPages<EventBrandJoinRow>(
    "fetchEventBrandLinks",
    `Failed to fetch lineup for ${slug}`,
    (from, to) =>
      supabase
        .from("event_brands")
        .select(EVENT_BRAND_SELECT)
        .eq("events.slug", slug)
        .eq("events.status", "published")
        .order("sort_order")
        // `sort_order` is not unique, so it cannot page on its own: equal rows
        // could reorder between pages and be duplicated or skipped. `id` is the
        // tiebreak the `(event_id, sort_order, id)` index already carries.
        .order("id")
        .range(from, to),
  );

  // Cast at the boundary: the generated types describe the `event_brands` row,
  // not this embed-shaped projection.
  return rows
    .map(eventBrandRowToDomain)
    .filter((link): link is EventBrandLink => link !== null);
}

/**
 * Brand counts for the hub, as one grouped query over every event on the page
 * rather than one `count` per event — constant in event count.
 *
 * Ceiling: this pulls one row per (event, approved brand) pair and counts them
 * in memory, paging around `max_rows`. Fine at directory scale (a few hundred
 * events x tens of brands); once the paging costs more than one round trip,
 * move it to an RPC that does `group by event_id` in Postgres.
 */
export async function fetchEventBrandCounts(
  supabase: ServiceClient,
  eventIds: string[],
): Promise<Map<string, number>> {
  const rows = await fetchAllPages<{ event_id: string }>(
    "fetchEventBrandCounts",
    "Failed to count event brands",
    (from, to) =>
      supabase
        .from("event_brands")
        .select(EVENT_BRAND_COUNT_SELECT)
        .in("event_id", eventIds)
        .eq("brands.status", "approved")
        // `id` is the primary key, so ordering on it alone is total — required
        // for the paging above to neither duplicate nor skip a row.
        .order("id")
        .range(from, to),
  );

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Cached entry points
//
// React's `cache()` compares arguments by identity, so every key here is a
// primitive. An array argument would allocate a fresh literal per call site and
// never hit — hence the newline-joined, deduped, sorted string keys.
// ---------------------------------------------------------------------------

export const getPublishedEvents = cache((): Promise<Event[]> =>
  fetchPublishedEvents(createServiceClient()),
);

export const getPublishedEventBySlug = cache(
  (slug: string): Promise<Event | null> =>
    fetchPublishedEventBySlug(createServiceClient(), slug),
);

const getEventBrandLinks = cache(
  (slug: string): Promise<EventBrandLink[]> =>
    fetchEventBrandLinks(createServiceClient(), slug),
);

/**
 * The lineup for one published event, brands hydrated through the shared
 * batched `getBrandsBySlugs` — one extra round trip for the whole lineup, and
 * the `status = 'approved'` filter plus `brandToDomain` come along with it.
 */
export async function getEventBrandEntries(
  slug: string,
): Promise<EventBrandEntry[]> {
  const links = await getEventBrandLinks(slug);
  if (links.length === 0) return [];

  const brands = await getBrandsBySlugs(links.map((link) => link.brandSlug));
  return composeEventBrands(links, brands);
}

/**
 * `brandsBySlugsCacheKey` is the same dedupe-sort-join on a list of opaque
 * kebab/uuid strings, so it is reused rather than copied — its contract is the
 * cache key, not the brand-ness of what it keys.
 *
 * The encoding stays inside this wrapper: `fetchEventBrandCounts` takes ids.
 */
const getEventBrandCountsByKey = cache(
  (eventIdKey: string): Promise<Map<string, number>> =>
    fetchEventBrandCounts(createServiceClient(), eventIdKey.split("\n")),
);

export async function getEventBrandCounts(
  eventIds: string[],
): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map();
  return getEventBrandCountsByKey(brandsBySlugsCacheKey(eventIds));
}
