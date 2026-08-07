/**
 * Seeds the `events` / `event_brands` tables from `content/events/<slug>.json`.
 *
 * The files are JSON, not TS: an event is pure data, a JSON diff is readable in
 * review, and a data file cannot execute anything when the seeder imports it.
 *
 * The run is idempotent and re-running it changes nothing:
 *   1. every file is parsed and validated FIRST — one bad file aborts the run
 *      before anything is written, so a typo can never half-apply;
 *   2. events are upserted on `slug`;
 *   3. every brand slug across every file resolves in ONE batched query;
 *   4. lineup rows are upserted on `(event_id, brand_id)`;
 *   5. lineup rows no longer named by the file are PRUNED.
 *
 * The file is the source of truth for ONE thing: an event's lineup. It is not
 * the source of truth for which events exist. Deleting a file does not unpublish
 * or delete its event — the row simply stops being touched — and an empty
 * directory exits early having done nothing at all. Unpublishing is a manual
 * `status` change (set `"status": "hidden"` in the file and re-run, or edit the
 * row directly).
 *
 * Step 5 is not optional. Without it, deleting a brand from the JSON leaves it
 * on the page forever and the file stops describing what is live — the way
 * naive seed scripts rot. Its semantics are deliberately asymmetric:
 *   - `"brands": []`  → prune everything (an explicitly empty lineup)
 *   - `brands` absent → prune nothing (an event stub can land before curation)
 *   - any unresolvable slug in the list → prune nothing for that event, because
 *     the file's intent is then unknown (see `planEventSeed`)
 *
 * No `status = 'approved'` filter is applied to brand resolution, deliberately:
 * a pending brand can be curated into a lineup in advance and simply will not
 * render until it is approved, because `getBrandsBySlugs` filters at read time.
 *
 * Run:
 *   pnpm seed-events --dry-run   # plan only, writes nothing
 *   pnpm seed-events
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { requestEventRevalidation } from "@/lib/cache/revalidate-client";
import { isSupabaseStorageUrl, isValidSlug } from "@/lib/services/brands";
import { EVENT_STATUSES, type EventStatus } from "@/lib/services/events";
import { createServiceClient } from "@/lib/supabase/service";
import { runCanonicalExhibitorSeed } from "./seed-event-exhibitors";

// ---------------------------------------------------------------------------
// File shape
// ---------------------------------------------------------------------------

/** One lineup entry as authored in the JSON file (camelCase, like every TS type). */
export type EventBrandInput = {
  slug: string;
  booth?: string | null;
  area?: string | null;
  areaEn?: string | null;
  note?: string | null;
  noteEn?: string | null;
  sortOrder?: number;
};

export type EventFileInput = {
  slug: string;
  name: string;
  nameEn?: string | null;
  summary: string;
  summaryEn?: string | null;
  description?: string | null;
  descriptionEn?: string | null;
  /** Taipei calendar date, `'YYYY-MM-DD'`. */
  startsOn: string;
  /** Taipei calendar date, `'YYYY-MM-DD'`, inclusive of the last day. */
  endsOn: string;
  venueName?: string | null;
  venueNameEn?: string | null;
  venueAddress?: string | null;
  city?: string | null;
  organizerName?: string | null;
  /** Newline-separated, one line per day band. */
  scheduleNote?: string | null;
  scheduleNoteEn?: string | null;
  admissionNote?: string | null;
  admissionNoteEn?: string | null;
  travelNote?: string | null;
  travelNoteEn?: string | null;
  lineupNote?: string | null;
  lineupNoteEn?: string | null;
  officialUrl?: string | null;
  ticketUrl?: string | null;
  isFree?: boolean | null;
  heroImageUrl?: string | null;
  status?: "draft" | "published" | "hidden";
  /** Absent and `[]` mean different things — see the prune semantics above. */
  brands?: EventBrandInput[];
};

/** Snake_case row ready for `events.upsert`. Translation happens here only. */
export type EventRowPayload = {
  slug: string;
  name: string;
  name_en: string | null;
  summary: string;
  summary_en: string | null;
  description: string | null;
  description_en: string | null;
  starts_on: string;
  ends_on: string;
  venue_name: string | null;
  venue_name_en: string | null;
  venue_address: string | null;
  city: string | null;
  organizer_name: string | null;
  schedule_note: string | null;
  schedule_note_en: string | null;
  admission_note: string | null;
  admission_note_en: string | null;
  travel_note: string | null;
  travel_note_en: string | null;
  lineup_note: string | null;
  lineup_note_en: string | null;
  official_url: string | null;
  ticket_url: string | null;
  is_free: boolean | null;
  hero_image_url: string | null;
  status: EventStatus;
};

export type ParsedEvent = {
  fileName: string;
  row: EventRowPayload;
  /** `null` when the file omitted `brands` entirely. */
  brands: EventBrandInput[] | null;
};

export const EXHIBITOR_OUTCOMES = [
  "matched_existing",
  "included_unlinked",
  "excluded",
  "needs_review",
  "out_of_scope",
] as const;

/** Outcomes that become canonical event_exhibitors rows. */
export const PERSISTED_EXHIBITOR_OUTCOMES = [
  "matched_existing",
  "included_unlinked",
] as const;

export type PersistedExhibitorOutcome =
  (typeof PERSISTED_EXHIBITOR_OUTCOMES)[number];

export type ExhibitorOutcome = (typeof EXHIBITOR_OUTCOMES)[number];
export type ExhibitorReviewPriority = "high" | "medium" | "low";

export type EventExhibitorInput = {
  sourceKey: string;
  sourceId?: string | null;
  name: string;
  nameEn?: string | null;
  booth?: string | null;
  area?: string | null;
  areaEn?: string | null;
  zone: string;
  eventCategory: string;
  sourceUrl: string;
  websiteUrl?: string | null;
  verifiedAt: string;
  sortOrder: number;
  reviewPriority: ExhibitorReviewPriority;
  verificationEvidence: {
    sourceUrl: string;
    detailUrl?: string | null;
    retrievedAt: string;
    basis: string;
  };
  outcome: ExhibitorOutcome;
  brandSlug?: string | null;
};

export type EventExhibitorLedgerInput = {
  schemaVersion: number;
  eventSlug: string;
  reportTimeEvidence: {
    retrievedAt: string;
    sourceUrl: string;
    checkpoint: Record<string, number>;
    notes?: string;
  };
  outcomes: ExhibitorOutcome[];
  exhibitors: EventExhibitorInput[];
};

export type ParsedExhibitorLedger = {
  fileName: string;
  eventSlug: string;
  exhibitors: EventExhibitorInput[];
  reportTimeEvidence: EventExhibitorLedgerInput["reportTimeEvidence"];
};

export type ExhibitorCoverage = {
  byZone: Record<string, number>;
  byOutcome: Record<ExhibitorOutcome, number>;
  total: number;
};

/**
 * Mirrors the `events.slug` check constraint in 20260731090000_events.sql. It
 * applies to the event's OWN slug only — `brands.slug` has no CHECK constraint
 * and its canonical rule is `isValidSlug`, which allows shorter slugs.
 */
const EVENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Mirrors the `summary` check constraint. Caught here so the DB never has to. */
const SUMMARY_MAX_LENGTH = 300;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Returns the error rather than throwing it, so every call site reads `throw fail(...)`. */
function fail(fileName: string, message: string): Error {
  return new Error(`${fileName}: ${message}`);
}

function requiredString(fileName: string, key: string, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw fail(fileName, `${key} is required and must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(
  fileName: string,
  key: string,
  value: unknown,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw fail(
      fileName,
      `${key} must be a string when present, got ${typeof value}`,
    );
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function optionalUrl(
  fileName: string,
  key: string,
  value: unknown,
): string | null {
  const raw = optionalString(fileName, key, value);
  if (raw === null) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw fail(fileName, `${key} must be an absolute URL: "${raw}"`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw fail(fileName, `${key} must be http(s): "${raw}"`);
  }
  return raw;
}

/**
 * Rejects `2026-02-31` as well as the wrong shape: the DB would take the shape
 * check but bounce the impossible day, and that error arrives with no file name.
 */
function calendarDate(fileName: string, key: string, value: unknown): string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    throw fail(
      fileName,
      `${key} must be a 'YYYY-MM-DD' date, got ${JSON.stringify(value)}`,
    );
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw fail(fileName, `${key} is not a real calendar date: "${value}"`);
  }
  return value;
}

function parseBrandEntry(
  fileName: string,
  entry: unknown,
  index: number,
): EventBrandInput {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw fail(fileName, `brands[${index}] must be an object`);
  }
  const input = entry as Record<string, unknown>;
  const slug = requiredString(fileName, `brands[${index}].slug`, input.slug);
  // The BRAND rule, not the event one: `brands.slug` has no CHECK constraint and
  // `isValidSlug` is what the brand service enforces on write. Validating a
  // brand slug against EVENT_SLUG_PATTERN (min 3 chars) rejected legitimate
  // 2-character brands and aborted the whole run before any client was created.
  if (!isValidSlug(slug)) {
    throw fail(
      fileName,
      `brands[${index}].slug is not a valid brand slug: "${slug}"`,
    );
  }

  const sortOrderRaw = input.sortOrder;
  if (
    sortOrderRaw !== undefined &&
    (typeof sortOrderRaw !== "number" || !Number.isInteger(sortOrderRaw))
  ) {
    throw fail(
      fileName,
      `brands[${index}].sortOrder must be an integer, got ${JSON.stringify(sortOrderRaw)}`,
    );
  }

  return {
    slug,
    booth: optionalString(fileName, `brands[${index}].booth`, input.booth),
    area: optionalString(fileName, `brands[${index}].area`, input.area),
    areaEn: optionalString(fileName, `brands[${index}].areaEn`, input.areaEn),
    note: optionalString(fileName, `brands[${index}].note`, input.note),
    noteEn: optionalString(fileName, `brands[${index}].noteEn`, input.noteEn),
    // Defaults to the file order, so an uncurated lineup still renders in the
    // order it was written instead of collapsing onto one sort bucket.
    sortOrder: typeof sortOrderRaw === "number" ? sortOrderRaw : index,
  };
}

/**
 * Pure: no Supabase, no filesystem. Every constraint the migration enforces is
 * checked here first so a failure names the file and the offending value rather
 * than surfacing as a Postgres constraint violation with neither.
 */
export function parseEventFile(fileName: string, raw: unknown): ParsedEvent {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw fail(fileName, "file must contain a JSON object");
  }
  const input = raw as Record<string, unknown>;

  const slug = requiredString(fileName, "slug", input.slug);
  if (!EVENT_SLUG_PATTERN.test(slug)) {
    throw fail(
      fileName,
      `slug "${slug}" must match ${EVENT_SLUG_PATTERN.source} (kebab-case, 3-80 chars)`,
    );
  }

  const summary = requiredString(fileName, "summary", input.summary);
  if (summary.length > SUMMARY_MAX_LENGTH) {
    throw fail(
      fileName,
      `summary is ${summary.length} characters, the maximum is ${SUMMARY_MAX_LENGTH}`,
    );
  }

  const startsOn = calendarDate(fileName, "startsOn", input.startsOn);
  const endsOn = calendarDate(fileName, "endsOn", input.endsOn);
  // Zero-padded ISO dates compare correctly as strings — no parsing needed.
  if (endsOn < startsOn) {
    throw fail(fileName, `endsOn "${endsOn}" is before startsOn "${startsOn}"`);
  }

  const heroImageUrl = optionalUrl(
    fileName,
    "heroImageUrl",
    input.heroImageUrl,
  );
  // Hotlinking a third-party host is what the brand-image repair pass had to
  // undo — an event hero is mirrored into our bucket before it is seeded, not
  // linked. Same predicate the brand service uses, imported rather than copied.
  if (heroImageUrl && !isSupabaseStorageUrl(heroImageUrl)) {
    throw fail(
      fileName,
      `heroImageUrl must be hosted on Supabase Storage, got "${heroImageUrl}"`,
    );
  }

  const statusRaw = input.status;
  if (
    statusRaw !== undefined &&
    !(EVENT_STATUSES as readonly unknown[]).includes(statusRaw)
  ) {
    throw fail(
      fileName,
      `status must be one of ${EVENT_STATUSES.join(", ")}, got ${JSON.stringify(statusRaw)}`,
    );
  }

  const isFree = input.isFree;
  if (isFree !== undefined && isFree !== null && typeof isFree !== "boolean") {
    throw fail(
      fileName,
      `isFree must be a boolean or null, got ${typeof isFree}`,
    );
  }

  let brands: EventBrandInput[] | null = null;
  if (input.brands !== undefined) {
    if (!Array.isArray(input.brands)) {
      throw fail(fileName, "brands must be an array when present");
    }
    brands = (input.brands as unknown[]).map((entry, index) =>
      parseBrandEntry(fileName, entry, index),
    );
    const seen = new Set<string>();
    for (const brand of brands) {
      if (seen.has(brand.slug)) {
        throw fail(fileName, `brands lists "${brand.slug}" more than once`);
      }
      seen.add(brand.slug);
    }
  }

  return {
    fileName,
    brands,
    row: {
      slug,
      name: requiredString(fileName, "name", input.name),
      name_en: optionalString(fileName, "nameEn", input.nameEn),
      summary,
      summary_en: optionalString(fileName, "summaryEn", input.summaryEn),
      description: optionalString(fileName, "description", input.description),
      description_en: optionalString(
        fileName,
        "descriptionEn",
        input.descriptionEn,
      ),
      starts_on: startsOn,
      ends_on: endsOn,
      venue_name: optionalString(fileName, "venueName", input.venueName),
      venue_name_en: optionalString(fileName, "venueNameEn", input.venueNameEn),
      venue_address: optionalString(
        fileName,
        "venueAddress",
        input.venueAddress,
      ),
      city: optionalString(fileName, "city", input.city),
      organizer_name: optionalString(
        fileName,
        "organizerName",
        input.organizerName,
      ),
      schedule_note: optionalString(
        fileName,
        "scheduleNote",
        input.scheduleNote,
      ),
      schedule_note_en: optionalString(
        fileName,
        "scheduleNoteEn",
        input.scheduleNoteEn,
      ),
      admission_note: optionalString(
        fileName,
        "admissionNote",
        input.admissionNote,
      ),
      admission_note_en: optionalString(
        fileName,
        "admissionNoteEn",
        input.admissionNoteEn,
      ),
      travel_note: optionalString(fileName, "travelNote", input.travelNote),
      travel_note_en: optionalString(
        fileName,
        "travelNoteEn",
        input.travelNoteEn,
      ),
      lineup_note: optionalString(fileName, "lineupNote", input.lineupNote),
      lineup_note_en: optionalString(
        fileName,
        "lineupNoteEn",
        input.lineupNoteEn,
      ),
      official_url: optionalUrl(fileName, "officialUrl", input.officialUrl),
      ticket_url: optionalUrl(fileName, "ticketUrl", input.ticketUrl),
      is_free: typeof isFree === "boolean" ? isFree : null,
      hero_image_url: heroImageUrl,
      // Fails closed, matching the column default: a seeded event is invisible
      // until someone deliberately publishes it.
      status: (statusRaw as EventStatus | undefined) ?? "draft",
    },
  };
}

function requiredExhibitorUrl(
  fileName: string,
  key: string,
  value: unknown,
): string {
  const url = optionalUrl(fileName, key, value);
  if (!url) throw fail(fileName, `${key} is required and must be http(s)`);
  return url;
}

function parseExhibitorOutcome(
  fileName: string,
  value: unknown,
  index: number,
): ExhibitorOutcome {
  if (
    typeof value !== "string" ||
    !(EXHIBITOR_OUTCOMES as readonly string[]).includes(value)
  ) {
    throw fail(
      fileName,
      `exhibitors[${index}].outcome must be exactly one of ${EXHIBITOR_OUTCOMES.join(", ")}`,
    );
  }
  return value as ExhibitorOutcome;
}

function parseExhibitorEntry(
  fileName: string,
  entry: unknown,
  index: number,
): EventExhibitorInput {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw fail(fileName, `exhibitors[${index}] must be an object`);
  }
  const input = entry as Record<string, unknown>;
  const sourceKey = requiredString(
    fileName,
    `exhibitors[${index}].sourceKey`,
    input.sourceKey,
  );
  const zone = requiredString(
    fileName,
    `exhibitors[${index}].zone`,
    input.zone,
  );
  const eventCategory = requiredString(
    fileName,
    `exhibitors[${index}].eventCategory`,
    input.eventCategory,
  );
  const outcome = parseExhibitorOutcome(fileName, input.outcome, index);
  const reviewPriorityRaw = input.reviewPriority;
  if (
    reviewPriorityRaw !== "high" &&
    reviewPriorityRaw !== "medium" &&
    reviewPriorityRaw !== "low"
  ) {
    throw fail(
      fileName,
      `exhibitors[${index}].reviewPriority must be high, medium, or low`,
    );
  }

  const verificationEvidenceRaw = input.verificationEvidence;
  if (
    typeof verificationEvidenceRaw !== "object" ||
    verificationEvidenceRaw === null ||
    Array.isArray(verificationEvidenceRaw)
  ) {
    throw fail(
      fileName,
      `exhibitors[${index}].verificationEvidence is required`,
    );
  }
  const evidence = verificationEvidenceRaw as Record<string, unknown>;
  const verificationEvidence = {
    sourceUrl: requiredExhibitorUrl(
      fileName,
      `exhibitors[${index}].verificationEvidence.sourceUrl`,
      evidence.sourceUrl,
    ),
    detailUrl:
      evidence.detailUrl === undefined || evidence.detailUrl === null
        ? null
        : requiredExhibitorUrl(
            fileName,
            `exhibitors[${index}].verificationEvidence.detailUrl`,
            evidence.detailUrl,
          ),
    retrievedAt: calendarDate(
      fileName,
      `exhibitors[${index}].verificationEvidence.retrievedAt`,
      evidence.retrievedAt,
    ),
    basis: requiredString(
      fileName,
      `exhibitors[${index}].verificationEvidence.basis`,
      evidence.basis,
    ),
  };

  const sortOrderRaw = input.sortOrder;
  if (typeof sortOrderRaw !== "number" || !Number.isInteger(sortOrderRaw)) {
    throw fail(fileName, `exhibitors[${index}].sortOrder must be an integer`);
  }
  if (sortOrderRaw < 0) {
    throw fail(fileName, `exhibitors[${index}].sortOrder must be non-negative`);
  }

  const brandSlugRaw = input.brandSlug;
  if (
    brandSlugRaw !== undefined &&
    brandSlugRaw !== null &&
    (typeof brandSlugRaw !== "string" || !isValidSlug(brandSlugRaw))
  ) {
    throw fail(
      fileName,
      `exhibitors[${index}].brandSlug must be a valid brand slug when present`,
    );
  }
  const brandSlug =
    typeof brandSlugRaw === "string" ? brandSlugRaw.trim() : null;

  const row: EventExhibitorInput = {
    sourceKey,
    sourceId: optionalString(
      fileName,
      `exhibitors[${index}].sourceId`,
      input.sourceId,
    ),
    name: requiredString(fileName, `exhibitors[${index}].name`, input.name),
    nameEn: optionalString(
      fileName,
      `exhibitors[${index}].nameEn`,
      input.nameEn,
    ),
    booth: optionalString(fileName, `exhibitors[${index}].booth`, input.booth),
    area: optionalString(fileName, `exhibitors[${index}].area`, input.area),
    areaEn: optionalString(
      fileName,
      `exhibitors[${index}].areaEn`,
      input.areaEn,
    ),
    zone,
    eventCategory,
    sourceUrl: requiredExhibitorUrl(
      fileName,
      `exhibitors[${index}].sourceUrl`,
      input.sourceUrl,
    ),
    websiteUrl:
      input.websiteUrl === undefined || input.websiteUrl === null
        ? null
        : optionalUrl(
            fileName,
            `exhibitors[${index}].websiteUrl`,
            input.websiteUrl,
          ),
    verifiedAt: calendarDate(
      fileName,
      `exhibitors[${index}].verifiedAt`,
      input.verifiedAt,
    ),
    sortOrder: sortOrderRaw,
    reviewPriority: reviewPriorityRaw,
    verificationEvidence,
    outcome,
    brandSlug,
  };

  const hasIncludedMetadata =
    row.name.trim() !== "" &&
    row.booth !== null &&
    row.area !== null &&
    row.zone.trim() !== "" &&
    row.eventCategory.trim() !== "" &&
    row.sourceUrl.trim() !== "" &&
    row.verifiedAt.trim() !== "";
  if (
    (outcome === "matched_existing" || outcome === "included_unlinked") &&
    !hasIncludedMetadata
  ) {
    throw fail(
      fileName,
      `exhibitors[${index}] ${outcome} requires name, booth, area, zone, eventCategory, sourceUrl, and verifiedAt`,
    );
  }
  if (outcome === "matched_existing" && !brandSlug) {
    throw fail(
      fileName,
      `exhibitors[${index}] matched_existing requires brandSlug`,
    );
  }
  if (outcome !== "matched_existing" && brandSlug) {
    throw fail(
      fileName,
      `exhibitors[${index}] ${outcome} cannot carry brandSlug`,
    );
  }
  if (zone.startsWith("K") && !["K1", "K2", "K3"].includes(zone)) {
    throw fail(
      fileName,
      `exhibitors[${index}] uses unsupported K-zone state "${zone}"`,
    );
  }
  if (
    ["K1", "K2", "K3"].includes(zone) &&
    outcome !== "matched_existing" &&
    outcome !== "included_unlinked"
  ) {
    throw fail(
      fileName,
      `exhibitors[${index}] K1/K2/K3 rows must be matched_existing or included_unlinked`,
    );
  }
  if (
    zone === "S" &&
    outcome !== "matched_existing" &&
    outcome !== "out_of_scope"
  ) {
    throw fail(
      fileName,
      `exhibitors[${index}] S rows must be matched_existing or out_of_scope`,
    );
  }
  if (zone === "J2" && outcome !== "matched_existing") {
    throw fail(
      fileName,
      `exhibitors[${index}] J2 rows must preserve matched_existing links`,
    );
  }

  return row;
}

export function exhibitorCoverage(
  exhibitors: EventExhibitorInput[],
): ExhibitorCoverage {
  const byZone: Record<string, number> = {};
  const byOutcome = Object.fromEntries(
    EXHIBITOR_OUTCOMES.map((outcome) => [outcome, 0]),
  ) as Record<ExhibitorOutcome, number>;
  for (const exhibitor of exhibitors) {
    byZone[exhibitor.zone] = (byZone[exhibitor.zone] ?? 0) + 1;
    byOutcome[exhibitor.outcome] += 1;
  }
  return { byZone, byOutcome, total: exhibitors.length };
}

export function parseExhibitorLedger(
  fileName: string,
  raw: unknown,
): ParsedExhibitorLedger {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw fail(fileName, "exhibitor ledger must contain a JSON object");
  }
  const input = raw as Record<string, unknown>;
  const eventSlug = requiredString(fileName, "eventSlug", input.eventSlug);
  if (!EVENT_SLUG_PATTERN.test(eventSlug)) {
    throw fail(fileName, `eventSlug "${eventSlug}" is not a valid event slug`);
  }
  if (input.schemaVersion !== 1) {
    throw fail(fileName, "schemaVersion must be 1");
  }
  if (!Array.isArray(input.exhibitors) || input.exhibitors.length === 0) {
    throw fail(fileName, "exhibitors must be a non-empty array");
  }
  if (!Array.isArray(input.outcomes)) {
    throw fail(fileName, "outcomes must be an array");
  }
  const outcomes = input.outcomes.map((value, index) =>
    parseExhibitorOutcome(fileName, value, index),
  );
  if (
    new Set(outcomes).size !== EXHIBITOR_OUTCOMES.length ||
    !EXHIBITOR_OUTCOMES.every((outcome) => outcomes.includes(outcome))
  ) {
    throw fail(
      fileName,
      `outcomes must list each terminal outcome exactly once: ${EXHIBITOR_OUTCOMES.join(", ")}`,
    );
  }

  const evidenceRaw = input.reportTimeEvidence;
  if (
    typeof evidenceRaw !== "object" ||
    evidenceRaw === null ||
    Array.isArray(evidenceRaw)
  ) {
    throw fail(fileName, "reportTimeEvidence is required");
  }
  const reportTimeEvidenceRaw = evidenceRaw as Record<string, unknown>;
  const checkpointRaw = reportTimeEvidenceRaw.checkpoint;
  if (
    typeof checkpointRaw !== "object" ||
    checkpointRaw === null ||
    Array.isArray(checkpointRaw)
  ) {
    throw fail(fileName, "reportTimeEvidence.checkpoint is required");
  }
  const checkpoint: Record<string, number> = {};
  for (const [zone, count] of Object.entries(
    checkpointRaw as Record<string, unknown>,
  )) {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw fail(
        fileName,
        `checkpoint for ${zone} must be a non-negative integer`,
      );
    }
    checkpoint[zone] = count;
  }
  const reportTimeEvidence = {
    retrievedAt: calendarDate(
      fileName,
      "reportTimeEvidence.retrievedAt",
      reportTimeEvidenceRaw.retrievedAt,
    ),
    sourceUrl: requiredExhibitorUrl(
      fileName,
      "reportTimeEvidence.sourceUrl",
      reportTimeEvidenceRaw.sourceUrl,
    ),
    checkpoint,
    notes:
      optionalString(
        fileName,
        "reportTimeEvidence.notes",
        reportTimeEvidenceRaw.notes,
      ) ?? undefined,
  };

  const exhibitors = (input.exhibitors as unknown[]).map((entry, index) =>
    parseExhibitorEntry(fileName, entry, index),
  );
  const sourceKeys = new Set<string>();
  const sortOrders = new Set<number>();
  const brandSlugs = new Set<string>();
  for (const exhibitor of exhibitors) {
    if (sourceKeys.has(exhibitor.sourceKey)) {
      throw fail(fileName, `duplicate sourceKey "${exhibitor.sourceKey}"`);
    }
    sourceKeys.add(exhibitor.sourceKey);
    if (sortOrders.has(exhibitor.sortOrder)) {
      throw fail(fileName, `duplicate sortOrder ${exhibitor.sortOrder}`);
    }
    sortOrders.add(exhibitor.sortOrder);
    if (exhibitor.brandSlug) {
      if (brandSlugs.has(exhibitor.brandSlug)) {
        throw fail(
          fileName,
          `conflicting links: brandSlug "${exhibitor.brandSlug}" appears more than once`,
        );
      }
      brandSlugs.add(exhibitor.brandSlug);
    }
  }

  const coverage = exhibitorCoverage(exhibitors);
  for (const zone of ["K1", "K2", "K3", "S"]) {
    if (coverage.byZone[zone] === undefined) {
      throw fail(fileName, `required zone ${zone} is incomplete or missing`);
    }
    if (checkpoint[zone] !== coverage.byZone[zone]) {
      throw fail(
        fileName,
        `coverage mismatch for ${zone}: report says ${checkpoint[zone] ?? "missing"}, ledger has ${coverage.byZone[zone]}`,
      );
    }
  }

  return { fileName, eventSlug, exhibitors, reportTimeEvidence };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export type EventBrandRowPayload = {
  event_id: string;
  brand_id: string;
  booth: string | null;
  area: string | null;
  area_en: string | null;
  note: string | null;
  note_en: string | null;
  sort_order: number;
};

export type EventSeedPlan = {
  eventSlug: string;
  eventId: string;
  upsertRows: EventBrandRowPayload[];
  /**
   * Brand ids on the event today that the file no longer names. Always empty
   * when `unknownBrandSlugs` is non-empty — see `planEventSeed`.
   */
  deleteBrandIds: string[];
  /** Slugs with no matching brand row — the run warns and exits non-zero. */
  unknownBrandSlugs: string[];
  insertCount: number;
  updateCount: number;
};

/**
 * Pure: takes already-resolved brand ids and the lineup that exists today, and
 * returns exactly what to write and what to remove. No Supabase calls, which is
 * what lets the prune semantics be tested without a database.
 */
export function planEventSeed(input: {
  eventSlug: string;
  eventId: string;
  brands: EventBrandInput[] | null;
  brandIdsBySlug: Map<string, string>;
  existingBrandIds: string[];
}): EventSeedPlan {
  const { eventSlug, eventId, brands, brandIdsBySlug, existingBrandIds } =
    input;
  const existing = new Set(existingBrandIds);

  // `brands` absent means "this file says nothing about the lineup" — leave the
  // curated rows alone. `brands: []` means "this event has no lineup" and prunes.
  if (brands === null) {
    return {
      eventSlug,
      eventId,
      upsertRows: [],
      deleteBrandIds: [],
      unknownBrandSlugs: [],
      insertCount: 0,
      updateCount: 0,
    };
  }

  const upsertRows: EventBrandRowPayload[] = [];
  const unknownBrandSlugs: string[] = [];
  const keep = new Set<string>();
  let insertCount = 0;
  let updateCount = 0;

  for (const brand of brands) {
    const brandId = brandIdsBySlug.get(brand.slug);
    if (!brandId) {
      unknownBrandSlugs.push(brand.slug);
      continue;
    }
    keep.add(brandId);
    if (existing.has(brandId)) updateCount += 1;
    else insertCount += 1;

    upsertRows.push({
      event_id: eventId,
      brand_id: brandId,
      booth: brand.booth ?? null,
      area: brand.area ?? null,
      area_en: brand.areaEn ?? null,
      note: brand.note ?? null,
      note_en: brand.noteEn ?? null,
      sort_order: brand.sortOrder ?? 0,
    });
  }

  // An unresolvable slug makes the file's intent for this lineup unknown, so
  // NOTHING is pruned: the brand was very likely renamed (four
  // brand_slug_redirects migrations say renames are a supported flow), its id
  // never lands in `keep`, and pruning would delete a still-valid curated row —
  // booth, area, note and sort_order — on the strength of a stale slug. The
  // warning plus the non-zero exit are what force the file to be fixed.
  //
  // Sorted so a dry-run preview and the live run report the same rows in the
  // same order regardless of how Postgres returned the existing lineup.
  const deleteBrandIds =
    unknownBrandSlugs.length > 0
      ? []
      : existingBrandIds.filter((brandId) => !keep.has(brandId)).sort();

  return {
    eventSlug,
    eventId,
    upsertRows,
    deleteBrandIds,
    unknownBrandSlugs,
    insertCount,
    updateCount,
  };
}

export type EventExhibitorRowPayload = {
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
};

export type EventExhibitorLinkIntent = {
  event_id: string;
  source_key: string;
  brand_id: string;
  booth: string | null;
  area: string | null;
  area_en: string | null;
  sort_order: number;
};

export type ExistingEventExhibitorRef = {
  id: string;
  source_key: string;
};

export type ExistingEventBrandRef = {
  id: string;
  brand_id: string;
  event_exhibitor_id: string | null;
  booth: string | null;
};

export type EventExhibitorSeedPlan = {
  eventSlug: string;
  eventId: string;
  exhibitorRows: EventExhibitorRowPayload[];
  linkIntents: EventExhibitorLinkIntent[];
  deleteEventBrandIds: string[];
  deleteExhibitorIds: string[];
  unknownBrandSlugs: string[];
  conflictingLinkSourceKeys: string[];
  safeToPrune: boolean;
  insertCount: number;
  updateCount: number;
  matchedBrandSlugs: string[];
};

function isPersistedExhibitor(
  exhibitor: EventExhibitorInput,
): exhibitor is EventExhibitorInput & {
  outcome: PersistedExhibitorOutcome;
} {
  return (PERSISTED_EXHIBITOR_OUTCOMES as readonly string[]).includes(
    exhibitor.outcome,
  );
}

/**
 * Pure canonical-roster plan. It deliberately returns no prune targets when a
 * matched brand cannot be resolved: an incomplete identity map is never
 * interpreted as a deletion request.
 */
export function planEventExhibitorSeed(input: {
  eventSlug: string;
  eventId: string;
  ledger: ParsedExhibitorLedger;
  brandIdsBySlug: Map<string, string>;
  existingExhibitors: ExistingEventExhibitorRef[];
  existingBrandLinks: ExistingEventBrandRef[];
}): EventExhibitorSeedPlan {
  const {
    eventSlug,
    eventId,
    ledger,
    brandIdsBySlug,
    existingExhibitors,
    existingBrandLinks,
  } = input;
  if (ledger.eventSlug !== eventSlug) {
    throw new Error(
      `Exhibitor ledger ${ledger.fileName} belongs to ${ledger.eventSlug}, expected ${eventSlug}`,
    );
  }

  const existingBySourceKey = new Map(
    existingExhibitors.map((row) => [row.source_key, row]),
  );
  const includedExhibitors = ledger.exhibitors.filter(isPersistedExhibitor);
  const exhibitorRows: EventExhibitorRowPayload[] = includedExhibitors.map(
    (exhibitor) => ({
      event_id: eventId,
      source_key: exhibitor.sourceKey,
      name: exhibitor.name,
      name_en: exhibitor.nameEn ?? null,
      booth: exhibitor.booth ?? null,
      area: exhibitor.area ?? null,
      area_en: exhibitor.areaEn ?? null,
      zone: exhibitor.zone,
      event_category: exhibitor.eventCategory,
      source_url: exhibitor.sourceUrl,
      website_url: exhibitor.websiteUrl ?? null,
      verified_at: exhibitor.verifiedAt,
      sort_order: exhibitor.sortOrder,
    }),
  );
  const unknownBrandSlugs: string[] = [];
  const linkIntents: EventExhibitorLinkIntent[] = [];
  const matchedBrandSlugs: string[] = [];

  for (const exhibitor of includedExhibitors) {
    if (exhibitor.outcome !== "matched_existing" || !exhibitor.brandSlug) {
      continue;
    }
    const brandId = brandIdsBySlug.get(exhibitor.brandSlug);
    if (!brandId) {
      unknownBrandSlugs.push(exhibitor.brandSlug);
      continue;
    }
    matchedBrandSlugs.push(exhibitor.brandSlug);
    linkIntents.push({
      event_id: eventId,
      source_key: exhibitor.sourceKey,
      brand_id: brandId,
      booth: exhibitor.booth ?? null,
      area: exhibitor.area ?? null,
      area_en: exhibitor.areaEn ?? null,
      sort_order: exhibitor.sortOrder,
    });
  }

  const safeToPrune = unknownBrandSlugs.length === 0;
  const expectedBrandBySourceKey = new Map(
    linkIntents.map((intent) => [intent.source_key, intent.brand_id]),
  );
  const expectedSourceByBrandId = new Map(
    linkIntents.map((intent) => [intent.brand_id, intent.source_key]),
  );
  const sourceKeyByExhibitorId = new Map(
    existingExhibitors.map((exhibitor) => [exhibitor.id, exhibitor.source_key]),
  );
  const conflictingLinkSourceKeys = [
    ...new Set(
      existingBrandLinks
        .map((link) => {
          const sourceKey = link.event_exhibitor_id
            ? sourceKeyByExhibitorId.get(link.event_exhibitor_id)
            : null;
          const expectedBrandId = sourceKey
            ? expectedBrandBySourceKey.get(sourceKey)
            : undefined;
          return sourceKey &&
            expectedBrandId &&
            expectedBrandId !== link.brand_id
            ? sourceKey
            : null;
        })
        .filter((value): value is string => value !== null),
    ),
  ].sort();
  if (conflictingLinkSourceKeys.length > 0) {
    return {
      eventSlug,
      eventId,
      exhibitorRows,
      linkIntents,
      deleteEventBrandIds: [],
      deleteExhibitorIds: [],
      unknownBrandSlugs: [...new Set(unknownBrandSlugs)].sort(),
      conflictingLinkSourceKeys,
      safeToPrune: false,
      insertCount: includedExhibitors.filter(
        (row) => !existingBySourceKey.has(row.sourceKey),
      ).length,
      updateCount: includedExhibitors.filter((row) =>
        existingBySourceKey.has(row.sourceKey),
      ).length,
      matchedBrandSlugs,
    };
  }
  if (!safeToPrune) {
    return {
      eventSlug,
      eventId,
      exhibitorRows,
      linkIntents,
      deleteEventBrandIds: [],
      deleteExhibitorIds: [],
      unknownBrandSlugs: [...new Set(unknownBrandSlugs)].sort(),
      conflictingLinkSourceKeys: [],
      safeToPrune: false,
      insertCount: includedExhibitors.filter(
        (row) => !existingBySourceKey.has(row.sourceKey),
      ).length,
      updateCount: includedExhibitors.filter((row) =>
        existingBySourceKey.has(row.sourceKey),
      ).length,
      matchedBrandSlugs,
    };
  }

  const sourceKeys = new Set(includedExhibitors.map((row) => row.sourceKey));
  const deleteEventBrandIds = existingBrandLinks
    .filter((row) => {
      if (!row.event_exhibitor_id) {
        // A legacy link with no canonical id is retained when its brand is
        // still intended; the link upsert above will attach the canonical id.
        return !expectedSourceByBrandId.has(row.brand_id);
      }
      const linkedSourceKey = sourceKeyByExhibitorId.get(
        row.event_exhibitor_id,
      );
      return (
        !sourceKeys.has(linkedSourceKey ?? "") ||
        expectedBrandBySourceKey.get(linkedSourceKey ?? "") !== row.brand_id
      );
    })
    .map((row) => row.id)
    .sort();
  const deleteExhibitorIds = existingExhibitors
    .filter((row) => !sourceKeys.has(row.source_key))
    .map((row) => row.id)
    .sort();

  return {
    eventSlug,
    eventId,
    exhibitorRows,
    linkIntents,
    deleteEventBrandIds,
    deleteExhibitorIds,
    unknownBrandSlugs: [],
    conflictingLinkSourceKeys: [],
    safeToPrune: true,
    insertCount: includedExhibitors.filter(
      (row) => !existingBySourceKey.has(row.sourceKey),
    ).length,
    updateCount: includedExhibitors.filter((row) =>
      existingBySourceKey.has(row.sourceKey),
    ).length,
    matchedBrandSlugs,
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const CONTENT_DIR = "content/events";

type IdSlugRow = { id: string; slug: string };
type JoinRow = { event_id: string; brand_id: string };

/**
 * `createServiceClient()` is typed against `any`, so every `data` arrives
 * untyped. This is the one place that shape is asserted.
 */
function rows<T>(data: unknown): T[] {
  return (data ?? []) as T[];
}

/**
 * supabase-js serializes `.in()` into the GET query string, so a 400-brand
 * lineup produces a >8KB request URI that the fronting proxy answers with a
 * bare HTTP 414 — no PostgREST error body, and a failure mode that only appears
 * once a lineup gets large. Every `.in()` list in this script is chunked.
 */
const IN_CHUNK_SIZE = 100;

function chunked<T>(values: T[], size = IN_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/**
 * Runs one `.in()` select per chunk and concatenates the rows, keeping the
 * `{ data, error }` shape every call site already handles. Stops at the first
 * failing chunk: a partial read must not be mistaken for the full set.
 */
async function selectInChunks<T>(
  values: string[],
  select: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<{ data: T[]; error: unknown }> {
  const collected: T[] = [];

  for (const chunk of chunked(values)) {
    const { data, error } = await select(chunk);
    if (error) return { data: collected, error };
    collected.push(...rows<T>(data));
  }

  return { data: collected, error: null };
}

async function loadEventFiles(directory: string): Promise<ParsedEvent[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  // Event metadata lives in `<slug>.json`; every other artifact for an event is
  // a dotted sidecar (`<slug>.exhibitors.json`, `<slug>.block-geometry.json`).
  // This is an allowlist rather than a denylist of known sidecars on purpose --
  // parsing a sidecar here would let it create or overwrite event fields, and a
  // denylist silently stops covering the next sidecar someone adds.
  const fileNames = entries.filter((name) => /^[^.]+\.json$/.test(name)).sort();
  const parsed: ParsedEvent[] = [];

  for (const fileName of fileNames) {
    const filePath = path.join(directory, fileName);
    const source = await readFile(filePath, "utf8");
    let raw: unknown;
    try {
      raw = JSON.parse(source);
    } catch (error) {
      throw new Error(
        `${filePath}: invalid JSON — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const event = parseEventFile(filePath, raw);
    const stem = fileName.slice(0, -".json".length);
    if (stem !== event.row.slug) {
      console.warn(
        `[warn] ${filePath} declares slug "${event.row.slug}" — rename the file to ${event.row.slug}.json`,
      );
    }
    parsed.push(event);
  }

  const seen = new Set<string>();
  for (const event of parsed) {
    if (seen.has(event.row.slug)) {
      throw new Error(`Duplicate event slug across files: "${event.row.slug}"`);
    }
    seen.add(event.row.slug);
  }

  return parsed;
}

async function loadExhibitorLedgers(
  directory: string,
): Promise<ParsedExhibitorLedger[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const fileNames = entries
    .filter((name) => name.endsWith(".exhibitors.json"))
    .sort();
  const parsed: ParsedExhibitorLedger[] = [];

  for (const fileName of fileNames) {
    const filePath = path.join(directory, fileName);
    const source = await readFile(filePath, "utf8");
    let raw: unknown;
    try {
      raw = JSON.parse(source);
    } catch (error) {
      throw new Error(
        `${filePath}: invalid JSON — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const ledger = parseExhibitorLedger(filePath, raw);
    const expectedStem = fileName.slice(0, -".exhibitors.json".length);
    if (expectedStem !== ledger.eventSlug) {
      console.warn(
        `[warn] ${filePath} declares eventSlug "${ledger.eventSlug}" — rename the file to ${ledger.eventSlug}.exhibitors.json`,
      );
    }
    parsed.push(ledger);
  }

  const seen = new Set<string>();
  for (const ledger of parsed) {
    if (seen.has(ledger.eventSlug)) {
      throw new Error(
        `Duplicate exhibitor ledger event slug: "${ledger.eventSlug}"`,
      );
    }
    seen.add(ledger.eventSlug);
  }
  return parsed;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  // Every file is parsed before any client is created: a validation failure must
  // abort with zero writes, not halfway through the directory.
  const events = await loadEventFiles(CONTENT_DIR);
  const ledgers = await loadExhibitorLedgers(CONTENT_DIR);
  if (events.length === 0) {
    console.log(`No event files in ${CONTENT_DIR}/ — nothing to do.`);
    return;
  }
  if (ledgers.length > 0) {
    await runCanonicalExhibitorSeed(
      events,
      ledgers,
      process.argv.includes("--dry-run"),
    );
    return;
  }
  console.log(
    `Parsed ${events.length} event file(s)${dryRun ? " (dry run — nothing will be written)" : ""}.`,
  );

  const supabase = createServiceClient();

  // Existing events, unfiltered. Ceiling: this reads (id, slug) for every event
  // row; at directory scale that is a few hundred rows. Above a few thousand,
  // filter it by the parsed slugs.
  const { data: existingEventRows, error: existingEventsError } = await supabase
    .from("events")
    .select("id, slug");
  if (existingEventsError) {
    console.error("Failed to read existing events:", existingEventsError);
    process.exit(1);
  }
  const eventIdsBySlug = new Map<string, string>(
    rows<IdSlugRow>(existingEventRows).map((row) => [row.slug, row.id]),
  );
  // Snapshot before the upsert writes new ids into the map: an event that
  // already had a row may have been public a minute ago, which is what decides
  // whether its path still needs revalidating after an unpublish.
  const preExistingSlugs = new Set(eventIdsBySlug.keys());
  const newEventCount = events.filter(
    (event) => !eventIdsBySlug.has(event.row.slug),
  ).length;

  // 1. Events first: the join rows need their ids. Skipped on a dry run, which
  //    is why a brand-new event plans its lineup against an empty id.
  if (!dryRun) {
    const { data: upserted, error: upsertError } = await supabase
      .from("events")
      .upsert(
        events.map((event) => event.row),
        { onConflict: "slug" },
      )
      .select("id, slug");
    if (upsertError) {
      console.error("Failed to upsert events:", upsertError);
      process.exit(1);
    }
    for (const row of rows<IdSlugRow>(upserted)) {
      eventIdsBySlug.set(row.slug, row.id);
    }
  }

  // 2. Every brand slug in every file, batched — no per-brand lookups, and
  //    deliberately no status filter (see the header). `selectInChunks` keeps
  //    this the only brand-slug `.in(...)` call site in the script.
  const brandSlugs = [
    ...new Set(
      events.flatMap((event) =>
        (event.brands ?? []).map((brand) => brand.slug),
      ),
    ),
  ];
  const brandIdsBySlug = new Map<string, string>();
  if (brandSlugs.length > 0) {
    const { data: brandRows, error: brandsError } =
      await selectInChunks<IdSlugRow>(brandSlugs, (chunk) =>
        supabase.from("brands").select("id, slug").in("slug", chunk),
      );
    if (brandsError) {
      console.error("Failed to resolve brand slugs:", brandsError);
      process.exit(1);
    }
    for (const row of brandRows) {
      brandIdsBySlug.set(row.slug, row.id);
    }
  }

  // 3. The lineup that exists today, for the events that already exist.
  const knownEventIds = events
    .map((event) => eventIdsBySlug.get(event.row.slug))
    .filter((id): id is string => Boolean(id));
  const existingBrandIdsByEvent = new Map<string, string[]>();
  if (knownEventIds.length > 0) {
    // Ceiling: PostgREST caps one response at `max_rows` (1000), so a chunk of
    // 100 events whose lineups total more than that comes back truncated with
    // HTTP 200. That under-reports the existing lineup, which only ever means
    // pruning less than it could — never deleting a row it should have kept.
    // Shrink IN_CHUNK_SIZE, or page with `.range()`, if lineups get that big.
    const { data: joinRows, error: joinError } = await selectInChunks<JoinRow>(
      knownEventIds,
      (chunk) =>
        supabase
          .from("event_brands")
          .select("event_id, brand_id")
          .in("event_id", chunk),
    );
    if (joinError) {
      console.error("Failed to read existing lineups:", joinError);
      process.exit(1);
    }
    for (const row of joinRows) {
      const bucket = existingBrandIdsByEvent.get(row.event_id) ?? [];
      bucket.push(row.brand_id);
      existingBrandIdsByEvent.set(row.event_id, bucket);
    }
  }

  const plans = events.map((event) => {
    const eventId = eventIdsBySlug.get(event.row.slug) ?? "";
    return planEventSeed({
      eventSlug: event.row.slug,
      eventId,
      brands: event.brands,
      brandIdsBySlug,
      existingBrandIds: existingBrandIdsByEvent.get(eventId) ?? [],
    });
  });

  const unknownBrandSlugs = [
    ...new Set(plans.flatMap((plan) => plan.unknownBrandSlugs)),
  ];
  for (const plan of plans) {
    for (const slug of plan.unknownBrandSlugs) {
      console.warn(
        `[warn] ${plan.eventSlug}: no brand with slug "${slug}" — row skipped`,
      );
    }
  }

  const totals = plans.reduce(
    (acc, plan) => ({
      inserts: acc.inserts + plan.insertCount,
      updates: acc.updates + plan.updateCount,
      deletes: acc.deletes + plan.deleteBrandIds.length,
    }),
    { inserts: 0, updates: 0, deletes: 0 },
  );

  console.log("\n--- Plan ---");
  console.log(`Events:            ${events.length} (${newEventCount} new)`);
  console.log(`Lineup inserts:    ${totals.inserts}`);
  console.log(`Lineup updates:    ${totals.updates}`);
  console.log(`Lineup deletes:    ${totals.deletes}`);
  console.log(`Unknown brands:    ${unknownBrandSlugs.length}`);

  if (dryRun) {
    console.log("\nDry run complete. Nothing was written.");
    if (unknownBrandSlugs.length > 0) process.exitCode = 1;
    return;
  }

  // 4. Lineup upserts, one call for every event.
  const upsertRows = plans.flatMap((plan) => plan.upsertRows);
  if (upsertRows.length > 0) {
    const { error: linkError } = await supabase
      .from("event_brands")
      .upsert(upsertRows, { onConflict: "event_id,brand_id" });
    if (linkError) {
      console.error("Failed to upsert lineup rows:", linkError);
      process.exit(1);
    }
  }

  // 5. Prune last, so a crash mid-run leaves an event with extra brands rather
  //    than with a lineup that was deleted and never rewritten.
  for (const plan of plans) {
    if (plan.deleteBrandIds.length === 0) continue;
    // Chunked like every other `.in()` here: a long delete list overflows the
    // request URI just as readily as a long select.
    for (const chunk of chunked(plan.deleteBrandIds)) {
      const { error: deleteError } = await supabase
        .from("event_brands")
        .delete()
        .eq("event_id", plan.eventId)
        .in("brand_id", chunk);
      if (deleteError) {
        console.error(
          `Failed to prune lineup for ${plan.eventSlug}:`,
          deleteError,
        );
        process.exit(1);
      }
    }
  }

  // Out-of-Next ISR trigger: this process has no request context, so
  // revalidatePath does not exist here. Never throws — a misconfigured laptop
  // degrades to a warning and the writes above still stand.
  //
  // A brand-new draft or hidden event is skipped: it has no public page and no
  // hub entry, so there is nothing cached to refresh. An event that already had
  // a row is always sent, published or not — publishing is a status flip, and
  // an unpublish that skipped revalidation would keep serving the live page and
  // listing it on the hub for the full ISR window.
  const revalidateSlugs = events
    .filter(
      (event) =>
        event.row.status === "published" ||
        preExistingSlugs.has(event.row.slug),
    )
    .map((event) => event.row.slug);
  const revalidation = await requestEventRevalidation(revalidateSlugs);
  // Reported, not swallowed: the writes landed but the site keeps serving
  // pre-seed HTML for the full revalidate window, and a clean exit code would
  // tell CI the run fully succeeded.
  if (!revalidation.ok) {
    console.error(
      `Revalidation failed (${revalidation.reason ?? "unknown"}): /events pages will serve stale HTML until the next ISR window. Fix the cause and re-run, or revalidate manually.`,
    );
    process.exitCode = 1;
  }

  console.log("\nDone.");
  if (unknownBrandSlugs.length > 0) {
    console.error(
      `Exiting non-zero: ${unknownBrandSlugs.length} unknown brand slug(s) — ${unknownBrandSlugs.join(", ")}`,
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Seed script failed:", error);
    process.exit(1);
  });
}
