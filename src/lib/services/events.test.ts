import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Brand } from "@/lib/types";
import type { createServiceClient } from "@/lib/supabase/service";
import {
  composeEventBrands,
  deriveAreaOptions,
  eventBrandRowToDomain,
  eventRowToDomain,
  fetchEventBrandCounts,
  fetchEventBrandLinks,
  fetchPublishedEventBySlug,
  fetchPublishedEvents,
  resolveEventPhase,
  taipeiToday,
  type EventBrandLink,
  type EventRow,
} from "./events";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function eventRow(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "2b0f5a4c-0000-4000-8000-000000000001",
    slug: "taipei-craft-market-2026",
    name: "台北手作市集 2026",
    name_en: "Taipei Craft Market 2026",
    summary: "四天的島內手作品牌市集。",
    summary_en: "A four-day market of island-made craft brands.",
    description: null,
    description_en: null,
    starts_on: "2026-08-06",
    ends_on: "2026-08-09",
    venue_name: "松山文創園區",
    venue_name_en: "Songshan Cultural Park",
    venue_address: "台北市信義區光復南路133號",
    city: "台北市",
    organizer_name: "Formoria",
    schedule_note: null,
    schedule_note_en: null,
    admission_note: null,
    admission_note_en: null,
    travel_note: null,
    travel_note_en: null,
    lineup_note: null,
    lineup_note_en: null,
    official_url: "https://example.tw/market",
    ticket_url: null,
    is_free: null,
    hero_image_url: null,
    status: "published",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function link(overrides: Partial<EventBrandLink> & { brandSlug: string }): EventBrandLink {
  return {
    booth: null,
    area: null,
    areaEn: null,
    note: null,
    noteEn: null,
    sortOrder: 0,
    ...overrides,
  };
}

/**
 * The lineup fixture carries the embedded `brands` / `events` objects PostgREST
 * returns for the `!inner` embeds, so the double can apply `events.slug` and
 * `brands.status` filters the same way the database would.
 */
type JoinFixture = {
  event_id: string;
  brand_id: string;
  booth: string | null;
  area: string | null;
  area_en: string | null;
  note: string | null;
  note_en: string | null;
  sort_order: number;
  brands: { slug: string; status: string };
  events: { slug: string; status: string };
};

function joinRow(
  overrides: Partial<JoinFixture> & { brands: { slug: string; status: string } },
): JoinFixture {
  return {
    event_id: "2b0f5a4c-0000-4000-8000-000000000001",
    brand_id: `brand-${overrides.brands.slug}`,
    booth: null,
    area: null,
    area_en: null,
    note: null,
    note_en: null,
    sort_order: 0,
    events: { slug: "taipei-craft-market-2026", status: "published" },
    ...overrides,
  };
}

/**
 * Only `slug` and `name` are read by the ordering and composition paths under
 * test; the rest of `Brand` is irrelevant here and inventing it would pin
 * fields these functions never touch.
 */
function brand(slug: string, name: string): Brand {
  return { id: `brand-${slug}`, slug, name } as unknown as Brand;
}

function brandMap(...brands: Brand[]): Map<string, Brand> {
  return new Map(brands.map((entry) => [entry.slug, entry]));
}

// ---------------------------------------------------------------------------
// Supabase query-builder double
//
// Mirrors src/lib/services/__tests__/brands-by-slugs.test.ts: the filters are
// actually applied to the fixture rows, so `status = 'published'` is exercised
// rather than merely recorded. Mocking `@/lib/supabase/service` to reach the
// same place is what scripts/check-test-boundaries.mjs forbids.
//
// `.range()` is honoured for real, which is what lets the pagination loops be
// tested: a page that comes back full has to trigger another round trip.
// ---------------------------------------------------------------------------

type QueryCall = {
  table: string;
  select: string;
  eqFilters: Array<[string, string]>;
  inFilters: Array<[string, string[]]>;
  orders: string[];
  ranges: Array<[number, number]>;
};

const queries: QueryCall[] = [];
let eventsTable: EventRow[] = [];
let eventBrandsTable: JoinFixture[] = [];
let queryError: { message: string } | null = null;

/** Resolves `'events.slug'` against the embedded object, like PostgREST does. */
function readPath(row: unknown, column: string): unknown {
  return column
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      row,
    );
}

function resolveRows(call: QueryCall): unknown[] {
  const source: unknown[] =
    call.table === "events" ? eventsTable : eventBrandsTable;

  let rows = source.filter(
    (row) =>
      call.eqFilters.every(
        ([column, value]) => String(readPath(row, column)) === value,
      ) &&
      call.inFilters.every(([column, values]) =>
        values.includes(String(readPath(row, column))),
      ),
  );

  for (const [from, to] of call.ranges) rows = rows.slice(from, to + 1);
  return rows;
}

function createClientDouble() {
  return {
    from(tableName: string) {
      const call: QueryCall = {
        table: tableName,
        select: "",
        eqFilters: [],
        inFilters: [],
        orders: [],
        ranges: [],
      };
      queries.push(call);

      const builder = {
        select(columns: string) {
          call.select = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.eqFilters.push([column, String(value)]);
          return builder;
        },
        in(column: string, values: unknown[]) {
          call.inFilters.push([column, values.map(String)]);
          return builder;
        },
        order(column: string) {
          call.orders.push(column);
          return builder;
        },
        range(from: number, to: number) {
          call.ranges.push([from, to]);
          return builder;
        },
        maybeSingle() {
          if (queryError) {
            return Promise.resolve({ data: null, error: queryError });
          }
          return Promise.resolve({
            data: resolveRows(call)[0] ?? null,
            error: null,
          });
        },
        then(
          resolve: (result: {
            data: unknown[] | null;
            error: { message: string } | null;
          }) => unknown,
        ) {
          if (queryError) {
            return Promise.resolve(resolve({ data: null, error: queryError }));
          }
          return Promise.resolve(
            resolve({ data: resolveRows(call), error: null }),
          );
        },
      };

      return builder;
    },
  };
}

function clientDouble() {
  return createClientDouble() as unknown as ReturnType<
    typeof createServiceClient
  >;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("events service", () => {
  beforeEach(() => {
    queries.length = 0;
    queryError = null;
    eventsTable = [];
    eventBrandsTable = [];
  });

  it("resolveEventPhase_resolves_five_boundaries", () => {
    // The last day is the one that keeps regressing: an event ending 8/9 is
    // still happening all day on 8/9, so `today > endsOn` (not `>=`) is what
    // moves it to `past`. Dates compare lexicographically as 'YYYY-MM-DD'.
    const event = { startsOn: "2026-08-06", endsOn: "2026-08-09" };

    expect(resolveEventPhase(event, "2026-08-05")).toBe("upcoming");
    expect(resolveEventPhase(event, "2026-08-06")).toBe("ongoing");
    expect(resolveEventPhase(event, "2026-08-07")).toBe("ongoing");
    expect(resolveEventPhase(event, "2026-08-09")).toBe("ongoing");
    expect(resolveEventPhase(event, "2026-08-10")).toBe("past");
  });

  it("taipeiToday_crosses_utc_boundary", () => {
    // 23:30 UTC is already 07:30 the next morning in Taipei. Anything deriving
    // "today" from UTC would call an 8/7 event upcoming for eight more hours.
    expect(taipeiToday(new Date("2026-08-06T23:30:00Z"))).toBe("2026-08-07");
    expect(taipeiToday(new Date("2026-08-06T15:00:00Z"))).toBe("2026-08-06");
    expect(taipeiToday(new Date("2026-08-06T14:59:00Z"))).toBe("2026-08-06");
  });

  it("composeEventBrands_drops_unresolved_slug", () => {
    // A brand can be un-approved or deleted between curation and render. The
    // lineup drops that row; it must not throw and take the whole page down.
    const entries = composeEventBrands(
      [link({ brandSlug: "molasses" }), link({ brandSlug: "gone-brand" })],
      brandMap(brand("molasses", "Molasses")),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]?.brand.slug).toBe("molasses");
  });

  it("composeEventBrands_orders_stably", () => {
    const links = [
      link({ brandSlug: "kiln-studio", sortOrder: 1 }),
      link({ brandSlug: "molasses", sortOrder: 0 }),
      link({ brandSlug: "arbor", sortOrder: 1 }),
      link({ brandSlug: "tide", sortOrder: 0 }),
    ];
    const brands = brandMap(
      brand("kiln-studio", "Kiln Studio"),
      brand("molasses", "Molasses"),
      brand("arbor", "Arbor"),
      brand("tide", "Tide"),
    );

    const first = composeEventBrands(links, brands).map((e) => e.brand.slug);
    const shuffled = [links[3], links[0], links[2], links[1]] as EventBrandLink[];
    const second = composeEventBrands(shuffled, brands).map((e) => e.brand.slug);

    expect(first).toEqual(["molasses", "tide", "arbor", "kiln-studio"]);
    expect(second).toEqual(first);
  });

  it("deriveAreaOptions_dedupes_and_localizes", () => {
    const entries = composeEventBrands(
      [
        link({ brandSlug: "molasses", area: "A區", areaEn: "Hall A" }),
        link({ brandSlug: "tide", area: "A區", areaEn: "Hall A" }),
        link({ brandSlug: "arbor", area: "B區", areaEn: "Hall B" }),
        link({ brandSlug: "kiln-studio", area: null, areaEn: null }),
      ],
      brandMap(
        brand("molasses", "Molasses"),
        brand("tide", "Tide"),
        brand("arbor", "Arbor"),
        brand("kiln-studio", "Kiln Studio"),
      ),
    );

    expect(deriveAreaOptions(entries, "zh-TW")).toEqual([
      { value: "A區", label: "A區" },
      { value: "B區", label: "B區" },
    ]);
    // The value stays the zh area so a filter link survives a locale switch;
    // only the label localizes.
    expect(deriveAreaOptions(entries, "en")).toEqual([
      { value: "A區", label: "Hall A" },
      { value: "B區", label: "Hall B" },
    ]);
  });

  it("eventRowToDomain_preserves_date_strings", () => {
    const event = eventRowToDomain(eventRow());

    expect(event.startsOn).toBe("2026-08-06");
    expect(event.endsOn).toBe("2026-08-09");
    expect(event.startsOn).not.toBeInstanceOf(Date);
    expect(event.nameEn).toBe("Taipei Craft Market 2026");
    expect(event.venueName).toBe("松山文創園區");
    expect(event.isFree).toBeNull();
  });

  it("eventBrandRowToDomain_accepts_both_embed_shapes", () => {
    // PostgREST hands a to-one embed back as an object; older stacks and the
    // array-shaped inference hand back an array. Both have to map.
    const base = {
      booth: "A12",
      area: "A區",
      area_en: "Hall A",
      note: null,
      note_en: null,
      sort_order: 3,
    };

    expect(
      eventBrandRowToDomain({ ...base, brands: { slug: "molasses" } })?.brandSlug,
    ).toBe("molasses");
    expect(
      eventBrandRowToDomain({ ...base, brands: [{ slug: "molasses" }] })?.booth,
    ).toBe("A12");
    expect(eventBrandRowToDomain({ ...base, brands: null })).toBeNull();
  });

  it("fetchPublishedEvents_filters_status", async () => {
    eventsTable = [
      eventRow({ slug: "published-market" }),
      eventRow({
        id: "2b0f5a4c-0000-4000-8000-000000000002",
        slug: "draft-market",
        status: "draft",
      }),
      eventRow({
        id: "2b0f5a4c-0000-4000-8000-000000000003",
        slug: "hidden-market",
        status: "hidden",
      }),
    ];

    const events = await fetchPublishedEvents(clientDouble());

    expect(queries[0]?.table).toBe("events");
    expect(queries[0]?.eqFilters).toContainEqual(["status", "published"]);
    expect(events.map((event) => event.slug)).toEqual(["published-market"]);
  });

  it("fetchPublishedEvents_throws_on_query_error", async () => {
    // A transient PostgREST error must not degrade to `[]`: an empty hub would
    // be cached for the full ISR window and look exactly like "no events yet",
    // with no signal anywhere that the database ever failed.
    queryError = { message: "connection reset" };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(fetchPublishedEvents(clientDouble())).rejects.toThrow();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("fetchPublishedEventBySlug_filters_status_and_returns_null_when_absent", async () => {
    eventsTable = [
      eventRow({ slug: "published-market" }),
      eventRow({
        id: "2b0f5a4c-0000-4000-8000-000000000002",
        slug: "draft-market",
        status: "draft",
      }),
    ];

    const found = await fetchPublishedEventBySlug(
      clientDouble(),
      "published-market",
    );
    expect(found?.slug).toBe("published-market");

    // A draft event is not-found, not a 200 with hidden copy.
    expect(
      await fetchPublishedEventBySlug(clientDouble(), "draft-market"),
    ).toBeNull();
  });

  it("fetchEventBrandLinks_pages_past_the_max_rows_cap", async () => {
    // PostgREST answers with the first `max_rows` (1000) rows and HTTP 200, so
    // an unbounded select silently truncates: `error` is null and the
    // throw-on-error convention never fires.
    eventBrandsTable = Array.from({ length: 1500 }, (_, index) =>
      joinRow({
        brands: { slug: `brand-${index}`, status: "approved" },
        sort_order: index,
      }),
    );

    const links = await fetchEventBrandLinks(
      clientDouble(),
      "taipei-craft-market-2026",
    );

    expect(links).toHaveLength(1500);
    expect(queries.map((call) => call.ranges[0])).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("fetchEventBrandCounts_pages_past_the_max_rows_cap", async () => {
    const eventId = "2b0f5a4c-0000-4000-8000-000000000001";
    eventBrandsTable = Array.from({ length: 1200 }, (_, index) =>
      joinRow({
        event_id: eventId,
        brands: { slug: `brand-${index}`, status: "approved" },
      }),
    );

    const counts = await fetchEventBrandCounts(clientDouble(), [eventId]);

    expect(counts.get(eventId)).toBe(1200);
    expect(queries).toHaveLength(2);
  });

  it("fetchEventBrandCounts_counts_only_approved_brands", async () => {
    // The hub card and the detail grid have to agree: the detail page hydrates
    // through `getBrandsBySlugs`, which filters `status = 'approved'`, so a
    // count over raw join rows advertises brands the grid never renders.
    const eventId = "2b0f5a4c-0000-4000-8000-000000000001";
    eventBrandsTable = [
      ...Array.from({ length: 9 }, (_, index) =>
        joinRow({
          event_id: eventId,
          brands: { slug: `approved-${index}`, status: "approved" },
        }),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        joinRow({
          event_id: eventId,
          brands: { slug: `pending-${index}`, status: "pending" },
        }),
      ),
    ];

    const counts = await fetchEventBrandCounts(clientDouble(), [eventId]);

    expect(counts.get(eventId)).toBe(9);
    expect(queries[0]?.eqFilters).toContainEqual(["brands.status", "approved"]);
  });

  it("fetchEventBrandCounts_returns_no_entry_for_an_empty_event", async () => {
    const withRows = "2b0f5a4c-0000-4000-8000-000000000001";
    const withoutRows = "2b0f5a4c-0000-4000-8000-000000000002";
    eventBrandsTable = [
      joinRow({
        event_id: withRows,
        brands: { slug: "molasses", status: "approved" },
      }),
    ];

    const counts = await fetchEventBrandCounts(clientDouble(), [
      withRows,
      withoutRows,
    ]);

    expect(counts.get(withRows)).toBe(1);
    expect(counts.has(withoutRows)).toBe(false);
  });
});
