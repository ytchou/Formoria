import { cache } from "react";

import type { AppLocale } from "@/i18n/locale-preference";
import type { Database } from "@/lib/supabase/database.types";
import type { Brand } from "@/lib/types";
import {
  normalizePublicBrandCard,
  type PublicBrandCard,
} from "@/lib/brands/contracts";
import { getBrandCategoryLabel } from "@/lib/brands/category-label";
import { isoDateInTimeZone } from "@/lib/date-range";
import { createServiceClient } from "@/lib/supabase/service";
import { brandsBySlugsCacheKey, getPublicBrandsBySlugs } from "./brands";

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
  /** Newline-separated, one line per day band — render with `whitespace-pre-line`. */
  scheduleNote: string | null;
  scheduleNoteEn: string | null;
  admissionNote: string | null;
  admissionNoteEn: string | null;
  travelNote: string | null;
  travelNoteEn: string | null;
  lineupNote: string | null;
  lineupNoteEn: string | null;
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
  brand: PublicBrandCard;
};

/** Canonical event roster row, independent of whether Formoria has a brand. */
export type EventExhibitor = {
  id: string;
  eventId: string;
  sourceKey: string;
  name: string;
  nameEn: string | null;
  booth: string | null;
  area: string | null;
  areaEn: string | null;
  zone: string | null;
  eventCategory: string;
  sourceUrl: string;
  websiteUrl: string | null;
  verifiedAt: string;
  sortOrder: number;
};

/** Every included exhibitor is returned; an unavailable brand is `null`. */
export type EventExhibitorEntry = EventExhibitor & {
  brand: PublicBrandCard | null;
};

/** Canonical Creative Expo zones surfaced by the interactive explorer. */
const CREATIVE_EXPO_ZONE_CODES = ["K1", "K2", "K3", "S"] as const;

export type CreativeExpoZone = (typeof CREATIVE_EXPO_ZONE_CODES)[number];

/**
 * A canonical exhibitor in a core zone, linked or not. The exhibitor list
 * renders the whole hall, so `brand` stays nullable here; only `zone` is
 * narrowed, because the zone allowlist is what defines "the hall".
 */
export type CreativeExpoEntry = Omit<EventExhibitorEntry, "zone"> & {
  zone: CreativeExpoZone;
};

/** A canonical exhibitor with a linked, public Formoria brand in a core zone. */
export type LinkedEventExhibitorEntry = Omit<
  EventExhibitorEntry,
  "brand" | "zone"
> & {
  brand: PublicBrandCard;
  zone: CreativeExpoZone;
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
  "id, slug, name, name_en, summary, summary_en, description, description_en, starts_on, ends_on, venue_name, venue_name_en, venue_address, city, organizer_name, schedule_note, schedule_note_en, admission_note, admission_note_en, travel_note, travel_note_en, lineup_note, lineup_note_en, official_url, ticket_url, is_free, hero_image_url, status, created_at, updated_at";

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

/**
 * Canonical roster projection. The inner event embed applies the same
 * published-event guard as the legacy lineup query without changing that
 * query's contract.
 */
const EVENT_EXHIBITOR_SELECT =
  "id, event_id, source_key, name, name_en, booth, area, area_en, zone, event_category, source_url, website_url, verified_at, sort_order, events!inner(slug, status)";

const EVENT_EXHIBITOR_BRAND_SELECT = "event_exhibitor_id, brands!inner(slug)";

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
    scheduleNote: row.schedule_note,
    scheduleNoteEn: row.schedule_note_en,
    admissionNote: row.admission_note,
    admissionNoteEn: row.admission_note_en,
    travelNote: row.travel_note,
    travelNoteEn: row.travel_note_en,
    lineupNote: row.lineup_note,
    lineupNoteEn: row.lineup_note_en,
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

export type EventExhibitorJoinRow = {
  id: string;
  event_id: string;
  source_key: string;
  name: string;
  name_en: string | null;
  booth: string | null;
  area: string | null;
  area_en: string | null;
  zone: string | null;
  event_category: string;
  source_url: string;
  website_url: string | null;
  verified_at: string;
  sort_order: number;
  events:
    | { slug: string; status: string }
    | Array<{ slug: string; status: string }>
    | null;
};

export function eventExhibitorRowToDomain(
  row: EventExhibitorJoinRow,
): EventExhibitor | null {
  const embedded = Array.isArray(row.events) ? row.events[0] : row.events;
  if (!embedded?.slug || embedded.status !== "published") return null;

  return {
    id: row.id,
    eventId: row.event_id,
    sourceKey: row.source_key,
    name: row.name,
    nameEn: row.name_en,
    booth: row.booth,
    area: row.area,
    areaEn: row.area_en,
    zone: row.zone,
    eventCategory: row.event_category,
    sourceUrl: row.source_url,
    websiteUrl: row.website_url,
    verifiedAt: row.verified_at,
    sortOrder: row.sort_order,
  };
}

export type EventExhibitorBrandJoinRow = {
  event_exhibitor_id: string | null;
  brands: { slug: string } | Array<{ slug: string }> | null;
};

function eventExhibitorBrandRowToSlug(
  row: EventExhibitorBrandJoinRow,
): { exhibitorId: string; brandSlug: string } | null {
  if (!row.event_exhibitor_id) return null;
  const embedded = Array.isArray(row.brands) ? row.brands[0] : row.brands;
  if (!embedded?.slug) return null;
  return { exhibitorId: row.event_exhibitor_id, brandSlug: embedded.slug };
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
  brandsBySlug: Map<string, Brand | PublicBrandCard>,
): EventBrandEntry[] {
  const entries: EventBrandEntry[] = [];

  for (const link of links) {
    const resolvedBrand = brandsBySlug.get(link.brandSlug);
    if (!resolvedBrand) continue;
    const brand = normalizePublicBrandCard(resolvedBrand);

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
 * Joins canonical exhibitors to optional public brands. Unlike the legacy
 * lineup composition, unresolved/hidden brands are retained as `brand: null`
 * so an official exhibitor never disappears from the event roster.
 */
export function composeEventExhibitorEntries(
  exhibitors: EventExhibitor[],
  brandSlugsByExhibitor: Map<string, string>,
  brandsBySlug: Map<string, Brand | PublicBrandCard>,
): EventExhibitorEntry[] {
  return exhibitors
    .map((exhibitor) => {
      const brandSlug = brandSlugsByExhibitor.get(exhibitor.id);
      const brand = brandSlug ? brandsBySlug.get(brandSlug) : undefined;

      return {
        ...exhibitor,
        brand: brand ? normalizePublicBrandCard(brand) : null,
      };
    })
    .sort(
      (a, b) =>
        a.sortOrder - b.sortOrder || compareStrings(a.sourceKey, b.sourceKey),
    );
}

/**
 * Narrows the canonical roster to linked Formoria brands in the four
 * interactive Creative Expo zones. `zone` is copied from the canonical row;
 * booth-prefix parsing belongs to the floor-map consistency check and never
 * changes this placement truth.
 */
export function selectLinkedEventExhibitorEntries(
  entries: readonly EventExhibitorEntry[],
): LinkedEventExhibitorEntry[] {
  return entries.filter(
    (entry): entry is LinkedEventExhibitorEntry =>
      entry.brand !== null &&
      (CREATIVE_EXPO_ZONE_CODES as readonly string[]).includes(
        entry.zone ?? "",
      ),
  );
}

/**
 * Narrows the canonical roster to the four Creative Expo zones without
 * requiring a Formoria brand link. Deliberately a sibling of
 * `selectLinkedEventExhibitorEntries` rather than a generalization of it: the
 * shared `EventBrandGrid` path still needs the linked-only projection, and the
 * two selections diverge on exactly the `brand !== null` clause.
 */
export function selectCreativeExpoEntries(
  entries: readonly EventExhibitorEntry[],
): CreativeExpoEntry[] {
  return entries.filter((entry): entry is CreativeExpoEntry =>
    (CREATIVE_EXPO_ZONE_CODES as readonly string[]).includes(entry.zone ?? ""),
  );
}

/** Adapts linked canonical rows to the existing shared BrandCard entry shape. */
export function projectLinkedEventExhibitorEntries(
  entries: readonly LinkedEventExhibitorEntry[],
): EventBrandEntry[] {
  return entries.map((entry) => ({
    brand: entry.brand,
    booth: entry.booth,
    area: entry.area,
    areaEn: entry.areaEn,
    note: null,
    noteEn: null,
    sortOrder: entry.sortOrder,
  }));
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
// double instead of mocking `@/lib/supabase/service`, which
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
 * Reads the canonical exhibitor roster for one published event. The roster is
 * paged independently from event_brands because an official event can include
 * exhibitors that have no Formoria brand row yet.
 */
export async function fetchEventExhibitors(
  supabase: ServiceClient,
  slug: string,
): Promise<EventExhibitor[]> {
  const rows = await fetchAllPages<EventExhibitorJoinRow>(
    "fetchEventExhibitors",
    `Failed to fetch exhibitors for ${slug}`,
    (from, to) =>
      supabase
        .from("event_exhibitors")
        .select(EVENT_EXHIBITOR_SELECT)
        .eq("events.slug", slug)
        .eq("events.status", "published")
        .order("sort_order")
        .order("id")
        .range(from, to),
  );

  return rows
    .map(eventExhibitorRowToDomain)
    .filter((row): row is EventExhibitor => row !== null);
}

/**
 * Reads the optional compatibility links for the canonical roster in one
 * batched query. `event_exhibitor_id` is nullable on legacy rows, and the
 * inner brand embed intentionally omits links whose brand has no slug.
 */
export async function fetchEventExhibitorBrandSlugs(
  supabase: ServiceClient,
  exhibitorIds: string[],
): Promise<Map<string, string>> {
  if (exhibitorIds.length === 0) return new Map();

  const rows = await fetchAllPages<EventExhibitorBrandJoinRow>(
    "fetchEventExhibitorBrandSlugs",
    "Failed to fetch exhibitor brand links",
    (from, to) =>
      supabase
        .from("event_brands")
        .select(EVENT_EXHIBITOR_BRAND_SELECT)
        .in("event_exhibitor_id", exhibitorIds)
        .order("id")
        .range(from, to),
  );

  const links = new Map<string, string>();
  for (const row of rows) {
    const link = eventExhibitorBrandRowToSlug(row);
    if (link) links.set(link.exhibitorId, link.brandSlug);
  }
  return links;
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

const getEventBrandLinks = cache((slug: string): Promise<EventBrandLink[]> =>
  fetchEventBrandLinks(createServiceClient(), slug),
);

const getEventExhibitors = cache((slug: string): Promise<EventExhibitor[]> =>
  fetchEventExhibitors(createServiceClient(), slug),
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

  const brands = await getPublicBrandsBySlugs(
    links.map((link) => link.brandSlug),
  );
  return composeEventBrands(links, brands);
}

/**
 * Canonical event roster with optional public-brand hydration. Every official
 * exhibitor remains in the result when its linked brand is hidden, deleted, or
 * not yet curated; only the `brand` field becomes `null`.
 */
export async function getEventExhibitorEntries(
  slug: string,
): Promise<EventExhibitorEntry[]> {
  const exhibitors = await getEventExhibitors(slug);
  if (exhibitors.length === 0) return [];

  const brandSlugsByExhibitor = await fetchEventExhibitorBrandSlugs(
    createServiceClient(),
    exhibitors.map((exhibitor) => exhibitor.id),
  );
  const brandSlugs = [...new Set(brandSlugsByExhibitor.values())];
  const brands =
    brandSlugs.length === 0
      ? new Map<string, PublicBrandCard>()
      : await getPublicBrandsBySlugs(brandSlugs);

  return composeEventExhibitorEntries(
    exhibitors,
    brandSlugsByExhibitor,
    brands,
  );
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
