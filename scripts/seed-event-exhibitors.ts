import { requestEventRevalidation } from "@/lib/cache/revalidate-client";
import { createServiceClient } from "@/lib/supabase/service";
import {
  planEventExhibitorSeed,
  type EventBrandRowPayload,
  type EventExhibitorSeedPlan,
  type ExistingEventBrandRef,
  type ExistingEventExhibitorRef,
  type ParsedEvent,
  type ParsedExhibitorLedger,
} from "./seed-events";

type IdSlugRow = { id: string; slug: string };
type EventExhibitorDbRow = ExistingEventExhibitorRef & {
  event_id: string;
};
type CanonicalExhibitorDbRow = EventExhibitorDbRow & {
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
};
type EventBrandDbRow = ExistingEventBrandRef & {
  event_id: string;
  area: string | null;
  area_en: string | null;
  note: string | null;
  note_en: string | null;
  sort_order: number;
};

const IN_CHUNK_SIZE = 100;

function rows<T>(data: unknown): T[] {
  return (data ?? []) as T[];
}

function chunked<T>(values: T[], size = IN_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function selectInChunks<T>(
  values: string[],
  select: (chunk: string[]) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>,
): Promise<T[]> {
  const collected: T[] = [];
  for (const chunk of chunked(values)) {
    const { data, error } = await select(chunk);
    if (error) throw new Error(error.message);
    collected.push(...rows<T>(data));
  }
  return collected;
}

function brandSlugsFor(
  events: ParsedEvent[],
  ledgers: ParsedExhibitorLedger[],
): string[] {
  return [
    ...new Set(
      events
        .flatMap((event) => (event.brands ?? []).map((brand) => brand.slug))
        .concat(
          ledgers.flatMap((ledger) =>
            ledger.exhibitors.flatMap((exhibitor) =>
              exhibitor.outcome === "matched_existing" && exhibitor.brandSlug
                ? [exhibitor.brandSlug]
                : [],
            ),
          ),
        ),
    ),
  ];
}

function planFor(
  event: ParsedEvent,
  ledgerBySlug: Map<string, ParsedExhibitorLedger>,
  eventIdsBySlug: Map<string, string>,
  brandIdsBySlug: Map<string, string>,
  existingExhibitorsByEvent: Map<string, ExistingEventExhibitorRef[]>,
  existingLinksByEvent: Map<string, ExistingEventBrandRef[]>,
): EventExhibitorSeedPlan {
  const ledger = ledgerBySlug.get(event.row.slug);
  if (!ledger)
    throw new Error(`Missing exhibitor ledger for ${event.row.slug}`);
  const eventId = eventIdsBySlug.get(event.row.slug) ?? "";
  return planEventExhibitorSeed({
    eventSlug: event.row.slug,
    eventId,
    ledger,
    brandIdsBySlug,
    existingExhibitors: existingExhibitorsByEvent.get(eventId) ?? [],
    existingBrandLinks: existingLinksByEvent.get(eventId) ?? [],
  });
}

function legacyRowsFromEvents(events: ParsedEvent[]): EventBrandRowPayload[] {
  return events.flatMap((event) =>
    (event.brands ?? []).map((brand) => ({
      event_id: "",
      brand_id: "",
      booth: brand.booth ?? null,
      area: brand.area ?? null,
      area_en: brand.areaEn ?? null,
      note: brand.note ?? null,
      note_en: brand.noteEn ?? null,
      sort_order: brand.sortOrder ?? 0,
    })),
  );
}

/** Seeds canonical exhibitor ledgers after all files and identities preflight. */
export async function runCanonicalExhibitorSeed(
  events: ParsedEvent[],
  ledgers: ParsedExhibitorLedger[],
  dryRun: boolean,
): Promise<void> {
  const eventSlugs = new Set(events.map((event) => event.row.slug));
  const ledgerSlugs = new Set(ledgers.map((ledger) => ledger.eventSlug));
  for (const ledger of ledgers) {
    if (!eventSlugs.has(ledger.eventSlug)) {
      throw new Error(
        `${ledger.fileName}: no matching event metadata file for ${ledger.eventSlug}`,
      );
    }
  }
  const missingLedgers = events
    .filter((event) => !ledgerSlugs.has(event.row.slug))
    .map((event) => event.row.slug);
  if (missingLedgers.length > 0) {
    throw new Error(
      `Missing exhibitor ledger for event metadata: ${missingLedgers.join(", ")}`,
    );
  }

  const supabase = createServiceClient();
  const { data: eventRows, error: eventReadError } = await supabase
    .from("events")
    .select("id, slug");
  if (eventReadError) {
    throw new Error(
      `Failed to read existing events: ${eventReadError.message}`,
    );
  }
  const eventIdsBySlug = new Map<string, string>(
    rows<IdSlugRow>(eventRows).map((row) => [row.slug, row.id]),
  );
  const preExistingSlugs = new Set(eventIdsBySlug.keys());
  const newEventCount = events.filter(
    (event) => !eventIdsBySlug.has(event.row.slug),
  ).length;

  const brandSlugs = brandSlugsFor(events, ledgers);
  const brandIdsBySlug = new Map<string, string>();
  for (const chunk of chunked(brandSlugs)) {
    const { data, error } = await supabase
      .from("brands")
      .select("id, slug")
      .in("slug", chunk);
    if (error)
      throw new Error(`Failed to resolve brand slugs: ${error.message}`);
    for (const row of rows<IdSlugRow>(data))
      brandIdsBySlug.set(row.slug, row.id);
  }
  const unknownBrandSlugs = brandSlugs.filter(
    (slug) => !brandIdsBySlug.has(slug),
  );
  if (unknownBrandSlugs.length > 0) {
    throw new Error(
      `Unknown brand identity disables pruning: ${unknownBrandSlugs.join(", ")}`,
    );
  }

  const existingEventIds = events
    .map((event) => eventIdsBySlug.get(event.row.slug))
    .filter((id): id is string => Boolean(id));
  const existingExhibitorsByEvent = new Map<
    string,
    ExistingEventExhibitorRef[]
  >();
  const existingLinksByEvent = new Map<string, ExistingEventBrandRef[]>();
  if (existingEventIds.length > 0) {
    const exhibitorRows = await selectInChunks<EventExhibitorDbRow>(
      existingEventIds,
      (chunk) =>
        supabase
          .from("event_exhibitors")
          .select("id, event_id, source_key")
          .in("event_id", chunk),
    );
    for (const row of exhibitorRows) {
      const bucket = existingExhibitorsByEvent.get(row.event_id) ?? [];
      bucket.push(row);
      existingExhibitorsByEvent.set(row.event_id, bucket);
    }
    const linkRows = await selectInChunks<EventBrandDbRow>(
      existingEventIds,
      (chunk) =>
        supabase
          .from("event_brands")
          .select("id, event_id, brand_id, event_exhibitor_id, booth")
          .in("event_id", chunk),
    );
    for (const row of linkRows) {
      const bucket = existingLinksByEvent.get(row.event_id) ?? [];
      bucket.push(row);
      existingLinksByEvent.set(row.event_id, bucket);
    }
  }

  const ledgerBySlug = new Map(
    ledgers.map((ledger) => [ledger.eventSlug, ledger]),
  );
  const ledgerEvents = events.filter((event) =>
    ledgerBySlug.has(event.row.slug),
  );
  const plans = ledgerEvents.map((event) =>
    planFor(
      event,
      ledgerBySlug,
      eventIdsBySlug,
      brandIdsBySlug,
      existingExhibitorsByEvent,
      existingLinksByEvent,
    ),
  );
  const conflictingLinks = plans.flatMap(
    (plan) => plan.conflictingLinkSourceKeys,
  );
  if (conflictingLinks.length > 0) {
    throw new Error(
      `Conflicting exhibitor links disable pruning: ${[...new Set(conflictingLinks)].sort().join(", ")}`,
    );
  }
  const totals = plans.reduce(
    (acc, plan) => ({
      exhibitors: acc.exhibitors + plan.exhibitorRows.length,
      links: acc.links + plan.linkIntents.length,
      inserts: acc.inserts + plan.insertCount,
      updates: acc.updates + plan.updateCount,
      deletes: acc.deletes + plan.deleteEventBrandIds.length,
    }),
    { exhibitors: 0, links: 0, inserts: 0, updates: 0, deletes: 0 },
  );
  console.log(
    `Parsed ${events.length} event file(s) and ${ledgers.length} exhibitor ledger(s)${dryRun ? " (dry run — nothing will be written)" : ""}.`,
  );
  console.log("\n--- Canonical exhibitor plan ---");
  console.log(`Events:              ${events.length} (${newEventCount} new)`);
  console.log(`Exhibitors:          ${totals.exhibitors}`);
  console.log(`Matched links:       ${totals.links}`);
  console.log(`Exhibitor inserts:   ${totals.inserts}`);
  console.log(`Exhibitor updates:   ${totals.updates}`);
  console.log(`Link deletes:        ${totals.deletes}`);
  console.log(`Legacy lineup rows:   ${legacyRowsFromEvents(events).length}`);
  console.log("Unknown brands:      0");
  if (dryRun) {
    console.log("\nDry run complete. Nothing was written.");
    return;
  }

  const { data: upsertedEvents, error: upsertEventsError } = await supabase
    .from("events")
    .upsert(
      events.map((event) => event.row),
      { onConflict: "slug" },
    )
    .select("id, slug");
  if (upsertEventsError) {
    throw new Error(`Failed to upsert events: ${upsertEventsError.message}`);
  }
  for (const row of rows<IdSlugRow>(upsertedEvents))
    eventIdsBySlug.set(row.slug, row.id);

  const livePlans = ledgerEvents.map((event) =>
    planFor(
      event,
      ledgerBySlug,
      eventIdsBySlug,
      brandIdsBySlug,
      existingExhibitorsByEvent,
      existingLinksByEvent,
    ),
  );
  const exhibitorRows = livePlans.flatMap((plan) => plan.exhibitorRows);
  if (exhibitorRows.length > 0) {
    const { error } = await supabase
      .from("event_exhibitors")
      .upsert(exhibitorRows, { onConflict: "event_id,source_key" });
    if (error) throw new Error(`Failed to upsert exhibitors: ${error.message}`);
  }

  const liveEventIds = events
    .map((event) => eventIdsBySlug.get(event.row.slug))
    .filter((id): id is string => Boolean(id));
  const canonicalRows = await selectInChunks<CanonicalExhibitorDbRow>(
    liveEventIds,
    (chunk) =>
      supabase
        .from("event_exhibitors")
        .select(
          "id, event_id, source_key, name, name_en, booth, area, area_en, zone, event_category, source_url, website_url, verified_at, sort_order",
        )
        .in("event_id", chunk),
  );
  const idsBySource = new Map(
    canonicalRows.map((row) => [`${row.event_id}:${row.source_key}`, row.id]),
  );
  const linkRows = livePlans.flatMap((plan) =>
    plan.linkIntents.map((intent) => {
      const eventExhibitorId = idsBySource.get(
        `${intent.event_id}:${intent.source_key}`,
      );
      if (!eventExhibitorId) {
        throw new Error(`Missing canonical exhibitor ${intent.source_key}`);
      }
      return {
        event_id: intent.event_id,
        brand_id: intent.brand_id,
        event_exhibitor_id: eventExhibitorId,
        booth: intent.booth,
        area: intent.area,
        area_en: intent.area_en,
        note: null,
        note_en: null,
        sort_order: intent.sort_order,
      };
    }),
  );
  const expectedExhibitorRows = livePlans.flatMap((plan) => plan.exhibitorRows);
  if (linkRows.length > 0) {
    const { error } = await supabase
      .from("event_brands")
      .upsert(linkRows, { onConflict: "event_id,brand_id" });
    if (error)
      throw new Error(`Failed to upsert exhibitor links: ${error.message}`);
  }

  for (const plan of livePlans) {
    for (const chunk of chunked(plan.deleteEventBrandIds)) {
      const { error } = await supabase
        .from("event_brands")
        .delete()
        .in("id", chunk);
      if (error)
        throw new Error(`Failed to prune exhibitor links: ${error.message}`);
    }
    for (const chunk of chunked(plan.deleteExhibitorIds)) {
      const { error } = await supabase
        .from("event_exhibitors")
        .delete()
        .eq("event_id", plan.eventId)
        .in("id", chunk);
      if (error)
        throw new Error(`Failed to prune exhibitors: ${error.message}`);
    }
  }

  const finalRows = await selectInChunks<CanonicalExhibitorDbRow>(
    liveEventIds,
    (chunk) =>
      supabase
        .from("event_exhibitors")
        .select(
          "id, event_id, source_key, name, name_en, booth, area, area_en, zone, event_category, source_url, website_url, verified_at, sort_order",
        )
        .in("event_id", chunk),
  );
  if (finalRows.length !== expectedExhibitorRows.length) {
    throw new Error(
      `Exhibitor count reconciliation failed: expected ${expectedExhibitorRows.length}, found ${finalRows.length}`,
    );
  }
  const actualExhibitorsByKey = new Map(
    finalRows.map((row) => [`${row.event_id}:${row.source_key}`, row]),
  );
  const exhibitorFields = [
    "event_id",
    "source_key",
    "name",
    "name_en",
    "booth",
    "area",
    "area_en",
    "zone",
    "event_category",
    "source_url",
    "website_url",
    "verified_at",
    "sort_order",
  ] as const;
  for (const expected of expectedExhibitorRows) {
    const actual = actualExhibitorsByKey.get(
      `${expected.event_id}:${expected.source_key}`,
    );
    if (!actual) {
      throw new Error(
        `Exhibitor identity reconciliation failed: missing ${expected.event_id}:${expected.source_key}`,
      );
    }
    for (const field of exhibitorFields) {
      if (actual[field] !== expected[field]) {
        throw new Error(
          `Exhibitor metadata reconciliation failed for ${expected.event_id}:${expected.source_key} (${field})`,
        );
      }
    }
  }

  const finalLinks = await selectInChunks<EventBrandDbRow>(
    liveEventIds,
    (chunk) =>
      supabase
        .from("event_brands")
        .select(
          "id, event_id, brand_id, event_exhibitor_id, booth, area, area_en, note, note_en, sort_order",
        )
        .in("event_id", chunk),
  );
  if (finalLinks.length !== linkRows.length) {
    throw new Error(
      `Event-brand link count reconciliation failed: expected ${linkRows.length}, found ${finalLinks.length}`,
    );
  }
  const actualLinksByKey = new Map(
    finalLinks.map((row) => [`${row.event_id}:${row.brand_id}`, row]),
  );
  if (actualLinksByKey.size !== finalLinks.length) {
    throw new Error(
      "Event-brand link cardinality reconciliation failed: duplicate event-brand identity",
    );
  }
  const linkFields = [
    "event_id",
    "brand_id",
    "event_exhibitor_id",
    "booth",
    "area",
    "area_en",
    "note",
    "note_en",
    "sort_order",
  ] as const;
  for (const expected of linkRows) {
    const actual = actualLinksByKey.get(
      `${expected.event_id}:${expected.brand_id}`,
    );
    if (!actual) {
      throw new Error(
        `Event-brand link reconciliation failed: missing ${expected.event_id}:${expected.brand_id}`,
      );
    }
    for (const field of linkFields) {
      if (actual[field] !== expected[field]) {
        throw new Error(
          `Event-brand placement reconciliation failed for ${expected.event_id}:${expected.brand_id} (${field})`,
        );
      }
    }
  }

  const exhibitorById = new Map(finalRows.map((row) => [row.id, row]));
  const linksByExhibitor = new Map<string, number>();
  for (const link of finalLinks) {
    if (!link.event_exhibitor_id) continue;
    const count = (linksByExhibitor.get(link.event_exhibitor_id) ?? 0) + 1;
    linksByExhibitor.set(link.event_exhibitor_id, count);
    if (count > 1) {
      throw new Error(
        `Event-brand link cardinality reconciliation failed for exhibitor ${link.event_exhibitor_id}`,
      );
    }
    const exhibitor = exhibitorById.get(link.event_exhibitor_id);
    if (!exhibitor || exhibitor.event_id !== link.event_id) {
      throw new Error(
        `Event-brand event-scope reconciliation failed for link ${link.id}`,
      );
    }
  }

  const revalidateSlugs = events
    .filter(
      (event) =>
        event.row.status === "published" ||
        preExistingSlugs.has(event.row.slug),
    )
    .map((event) => event.row.slug);
  const revalidation = await requestEventRevalidation(revalidateSlugs);
  if (!revalidation.ok) {
    console.error(
      `Revalidation failed (${revalidation.reason ?? "unknown"}): /events pages will serve stale HTML until the next revalidate window.`,
    );
    process.exitCode = 1;
  }
  console.log("\nCanonical exhibitor seed complete.");
}
