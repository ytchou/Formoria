/**
 * Seeds the `events` / `event_brands` tables from `content/events/<slug>.json`.
 *
 * The files are JSON, not TS: an event is pure data, a JSON diff is readable in
 * review, and a data file cannot execute anything when the seeder imports it.
 *
 * The run is idempotent and the source of truth is the file:
 *   1. every file is parsed and validated FIRST — one bad file aborts the run
 *      before anything is written, so a typo can never half-apply;
 *   2. events are upserted on `slug`;
 *   3. every brand slug across every file resolves in ONE batched query;
 *   4. lineup rows are upserted on `(event_id, brand_id)`;
 *   5. lineup rows no longer named by the file are PRUNED.
 *
 * Step 5 is not optional. Without it, deleting a brand from the JSON leaves it
 * on the page forever and the file stops describing what is live — the way
 * naive seed scripts rot. Its semantics are deliberately asymmetric:
 *   - `"brands": []`  → prune everything (an explicitly empty lineup)
 *   - `brands` absent → prune nothing (an event stub can land before curation)
 *
 * No `status = 'approved'` filter is applied to brand resolution, deliberately:
 * a pending brand can be curated into a lineup in advance and simply will not
 * render until it is approved, because `getBrandsBySlugs` filters at read time.
 *
 * Run:
 *   pnpm seed-events --dry-run   # plan only, writes nothing
 *   pnpm seed-events
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { requestEventRevalidation } from '@/lib/cache/revalidate-client'
import { createServiceClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// File shape
// ---------------------------------------------------------------------------

/** One lineup entry as authored in the JSON file (camelCase, like every TS type). */
export type EventBrandInput = {
  slug: string
  booth?: string | null
  area?: string | null
  areaEn?: string | null
  note?: string | null
  noteEn?: string | null
  sortOrder?: number
}

export type EventFileInput = {
  slug: string
  name: string
  nameEn?: string | null
  summary: string
  summaryEn?: string | null
  description?: string | null
  descriptionEn?: string | null
  /** Taipei calendar date, `'YYYY-MM-DD'`. */
  startsOn: string
  /** Taipei calendar date, `'YYYY-MM-DD'`, inclusive of the last day. */
  endsOn: string
  venueName?: string | null
  venueNameEn?: string | null
  venueAddress?: string | null
  city?: string | null
  organizerName?: string | null
  officialUrl?: string | null
  ticketUrl?: string | null
  isFree?: boolean | null
  heroImageUrl?: string | null
  status?: 'draft' | 'published' | 'hidden'
  /** Absent and `[]` mean different things — see the prune semantics above. */
  brands?: EventBrandInput[]
}

/** Snake_case row ready for `events.upsert`. Translation happens here only. */
export type EventRowPayload = {
  slug: string
  name: string
  name_en: string | null
  summary: string
  summary_en: string | null
  description: string | null
  description_en: string | null
  starts_on: string
  ends_on: string
  venue_name: string | null
  venue_name_en: string | null
  venue_address: string | null
  city: string | null
  organizer_name: string | null
  official_url: string | null
  ticket_url: string | null
  is_free: boolean | null
  hero_image_url: string | null
  status: EventStatus
}

export type ParsedEvent = {
  fileName: string
  row: EventRowPayload
  /** `null` when the file omitted `brands` entirely. */
  brands: EventBrandInput[] | null
}

const EVENT_STATUSES = ['draft', 'published', 'hidden'] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

/** Mirrors the `events.slug` check constraint in 20260731090000_events.sql. */
const EVENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
/** Mirrors the `summary` check constraint. Caught here so the DB never has to. */
const SUMMARY_MAX_LENGTH = 300

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Returns the error rather than throwing it, so every call site reads `throw fail(...)`. */
function fail(fileName: string, message: string): Error {
  return new Error(`${fileName}: ${message}`)
}

function requiredString(
  fileName: string,
  key: string,
  value: unknown,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw fail(fileName, `${key} is required and must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(
  fileName: string,
  key: string,
  value: unknown,
): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw fail(
      fileName,
      `${key} must be a string when present, got ${typeof value}`,
    )
  }
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function optionalUrl(
  fileName: string,
  key: string,
  value: unknown,
): string | null {
  const raw = optionalString(fileName, key, value)
  if (raw === null) return null

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw fail(fileName, `${key} must be an absolute URL: "${raw}"`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw fail(fileName, `${key} must be http(s): "${raw}"`)
  }
  return raw
}

/**
 * Same rule as `isSupabaseStorageUrl` in src/lib/services/brands.ts: our own
 * Storage origin, or any `*.supabase.co` host serving `/storage/`. Hotlinking a
 * third-party host is what the brand-image repair pass had to undo — an event
 * hero has to be mirrored into our bucket before it is seeded, not linked.
 */
function isSupabaseStorageUrl(url: string): boolean {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (configured && url.startsWith(`${configured}/storage/`)) return true

  try {
    const parsed = new URL(url)
    return (
      parsed.hostname.toLowerCase().endsWith('.supabase.co') &&
      parsed.pathname.startsWith('/storage/')
    )
  } catch {
    return false
  }
}

/**
 * Rejects `2026-02-31` as well as the wrong shape: the DB would take the shape
 * check but bounce the impossible day, and that error arrives with no file name.
 */
function calendarDate(fileName: string, key: string, value: unknown): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw fail(
      fileName,
      `${key} must be a 'YYYY-MM-DD' date, got ${JSON.stringify(value)}`,
    )
  }
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw fail(fileName, `${key} is not a real calendar date: "${value}"`)
  }
  return value
}

function parseBrandEntry(
  fileName: string,
  entry: unknown,
  index: number,
): EventBrandInput {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw fail(fileName, `brands[${index}] must be an object`)
  }
  const input = entry as Record<string, unknown>
  const slug = requiredString(fileName, `brands[${index}].slug`, input.slug)
  if (!EVENT_SLUG_PATTERN.test(slug)) {
    throw fail(
      fileName,
      `brands[${index}].slug is not a valid brand slug: "${slug}"`,
    )
  }

  const sortOrderRaw = input.sortOrder
  if (
    sortOrderRaw !== undefined &&
    (typeof sortOrderRaw !== 'number' || !Number.isInteger(sortOrderRaw))
  ) {
    throw fail(
      fileName,
      `brands[${index}].sortOrder must be an integer, got ${JSON.stringify(sortOrderRaw)}`,
    )
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
    sortOrder: typeof sortOrderRaw === 'number' ? sortOrderRaw : index,
  }
}

/**
 * Pure: no Supabase, no filesystem. Every constraint the migration enforces is
 * checked here first so a failure names the file and the offending value rather
 * than surfacing as a Postgres constraint violation with neither.
 */
export function parseEventFile(fileName: string, raw: unknown): ParsedEvent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw fail(fileName, 'file must contain a JSON object')
  }
  const input = raw as Record<string, unknown>

  const slug = requiredString(fileName, 'slug', input.slug)
  if (!EVENT_SLUG_PATTERN.test(slug)) {
    throw fail(
      fileName,
      `slug "${slug}" must match ${EVENT_SLUG_PATTERN.source} (kebab-case, 3-80 chars)`,
    )
  }

  const summary = requiredString(fileName, 'summary', input.summary)
  if (summary.length > SUMMARY_MAX_LENGTH) {
    throw fail(
      fileName,
      `summary is ${summary.length} characters, the maximum is ${SUMMARY_MAX_LENGTH}`,
    )
  }

  const startsOn = calendarDate(fileName, 'startsOn', input.startsOn)
  const endsOn = calendarDate(fileName, 'endsOn', input.endsOn)
  // Zero-padded ISO dates compare correctly as strings — no parsing needed.
  if (endsOn < startsOn) {
    throw fail(fileName, `endsOn "${endsOn}" is before startsOn "${startsOn}"`)
  }

  const heroImageUrl = optionalUrl(fileName, 'heroImageUrl', input.heroImageUrl)
  if (heroImageUrl && !isSupabaseStorageUrl(heroImageUrl)) {
    throw fail(
      fileName,
      `heroImageUrl must be hosted on Supabase Storage, got "${heroImageUrl}"`,
    )
  }

  const statusRaw = input.status
  if (
    statusRaw !== undefined &&
    !(EVENT_STATUSES as readonly unknown[]).includes(statusRaw)
  ) {
    throw fail(
      fileName,
      `status must be one of ${EVENT_STATUSES.join(', ')}, got ${JSON.stringify(statusRaw)}`,
    )
  }

  const isFree = input.isFree
  if (isFree !== undefined && isFree !== null && typeof isFree !== 'boolean') {
    throw fail(fileName, `isFree must be a boolean or null, got ${typeof isFree}`)
  }

  let brands: EventBrandInput[] | null = null
  if (input.brands !== undefined) {
    if (!Array.isArray(input.brands)) {
      throw fail(fileName, 'brands must be an array when present')
    }
    brands = (input.brands as unknown[]).map((entry, index) =>
      parseBrandEntry(fileName, entry, index),
    )
    const seen = new Set<string>()
    for (const brand of brands) {
      if (seen.has(brand.slug)) {
        throw fail(fileName, `brands lists "${brand.slug}" more than once`)
      }
      seen.add(brand.slug)
    }
  }

  return {
    fileName,
    brands,
    row: {
      slug,
      name: requiredString(fileName, 'name', input.name),
      name_en: optionalString(fileName, 'nameEn', input.nameEn),
      summary,
      summary_en: optionalString(fileName, 'summaryEn', input.summaryEn),
      description: optionalString(fileName, 'description', input.description),
      description_en: optionalString(
        fileName,
        'descriptionEn',
        input.descriptionEn,
      ),
      starts_on: startsOn,
      ends_on: endsOn,
      venue_name: optionalString(fileName, 'venueName', input.venueName),
      venue_name_en: optionalString(fileName, 'venueNameEn', input.venueNameEn),
      venue_address: optionalString(
        fileName,
        'venueAddress',
        input.venueAddress,
      ),
      city: optionalString(fileName, 'city', input.city),
      organizer_name: optionalString(
        fileName,
        'organizerName',
        input.organizerName,
      ),
      official_url: optionalUrl(fileName, 'officialUrl', input.officialUrl),
      ticket_url: optionalUrl(fileName, 'ticketUrl', input.ticketUrl),
      is_free: typeof isFree === 'boolean' ? isFree : null,
      hero_image_url: heroImageUrl,
      // Fails closed, matching the column default: a seeded event is invisible
      // until someone deliberately publishes it.
      status: (statusRaw as EventStatus | undefined) ?? 'draft',
    },
  }
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export type EventBrandRowPayload = {
  event_id: string
  brand_id: string
  booth: string | null
  area: string | null
  area_en: string | null
  note: string | null
  note_en: string | null
  sort_order: number
}

export type EventSeedPlan = {
  eventSlug: string
  eventId: string
  upsertRows: EventBrandRowPayload[]
  /** Brand ids on the event today that the file no longer names. */
  deleteBrandIds: string[]
  /** Slugs with no matching brand row — the run warns and exits non-zero. */
  unknownBrandSlugs: string[]
  insertCount: number
  updateCount: number
}

/**
 * Pure: takes already-resolved brand ids and the lineup that exists today, and
 * returns exactly what to write and what to remove. No Supabase calls, which is
 * what lets the prune semantics be tested without a database.
 */
export function planEventSeed(input: {
  eventSlug: string
  eventId: string
  brands: EventBrandInput[] | null
  brandIdsBySlug: Map<string, string>
  existingBrandIds: string[]
}): EventSeedPlan {
  const { eventSlug, eventId, brands, brandIdsBySlug, existingBrandIds } = input
  const existing = new Set(existingBrandIds)

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
    }
  }

  const upsertRows: EventBrandRowPayload[] = []
  const unknownBrandSlugs: string[] = []
  const keep = new Set<string>()
  let insertCount = 0
  let updateCount = 0

  for (const brand of brands) {
    const brandId = brandIdsBySlug.get(brand.slug)
    if (!brandId) {
      unknownBrandSlugs.push(brand.slug)
      continue
    }
    keep.add(brandId)
    if (existing.has(brandId)) updateCount += 1
    else insertCount += 1

    upsertRows.push({
      event_id: eventId,
      brand_id: brandId,
      booth: brand.booth ?? null,
      area: brand.area ?? null,
      area_en: brand.areaEn ?? null,
      note: brand.note ?? null,
      note_en: brand.noteEn ?? null,
      sort_order: brand.sortOrder ?? 0,
    })
  }

  // Sorted so a dry-run preview and the live run report the same rows in the
  // same order regardless of how Postgres returned the existing lineup.
  const deleteBrandIds = existingBrandIds
    .filter((brandId) => !keep.has(brandId))
    .sort()

  return {
    eventSlug,
    eventId,
    upsertRows,
    deleteBrandIds,
    unknownBrandSlugs,
    insertCount,
    updateCount,
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const CONTENT_DIR = 'content/events'

type IdSlugRow = { id: string; slug: string }
type JoinRow = { event_id: string; brand_id: string }

/**
 * `createServiceClient()` is typed against `any`, so every `data` arrives
 * untyped. This is the one place that shape is asserted.
 */
function rows<T>(data: unknown): T[] {
  return (data ?? []) as T[]
}

async function loadEventFiles(directory: string): Promise<ParsedEvent[]> {
  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return []
  }

  const fileNames = entries.filter((name) => name.endsWith('.json')).sort()
  const parsed: ParsedEvent[] = []

  for (const fileName of fileNames) {
    const filePath = path.join(directory, fileName)
    const source = await readFile(filePath, 'utf8')
    let raw: unknown
    try {
      raw = JSON.parse(source)
    } catch (error) {
      throw new Error(
        `${filePath}: invalid JSON — ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const event = parseEventFile(filePath, raw)
    const stem = fileName.slice(0, -'.json'.length)
    if (stem !== event.row.slug) {
      console.warn(
        `[warn] ${filePath} declares slug "${event.row.slug}" — rename the file to ${event.row.slug}.json`,
      )
    }
    parsed.push(event)
  }

  const seen = new Set<string>()
  for (const event of parsed) {
    if (seen.has(event.row.slug)) {
      throw new Error(`Duplicate event slug across files: "${event.row.slug}"`)
    }
    seen.add(event.row.slug)
  }

  return parsed
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  // Every file is parsed before any client is created: a validation failure must
  // abort with zero writes, not halfway through the directory.
  const events = await loadEventFiles(CONTENT_DIR)
  if (events.length === 0) {
    console.log(`No event files in ${CONTENT_DIR}/ — nothing to do.`)
    return
  }
  console.log(
    `Parsed ${events.length} event file(s)${dryRun ? ' (dry run — nothing will be written)' : ''}.`,
  )

  const supabase = createServiceClient()

  // Existing events, unfiltered. Ceiling: this reads (id, slug) for every event
  // row; at directory scale that is a few hundred rows. Above a few thousand,
  // filter it by the parsed slugs.
  const { data: existingEventRows, error: existingEventsError } = await supabase
    .from('events')
    .select('id, slug')
  if (existingEventsError) {
    console.error('Failed to read existing events:', existingEventsError)
    process.exit(1)
  }
  const eventIdsBySlug = new Map<string, string>(
    rows<IdSlugRow>(existingEventRows).map((row) => [row.slug, row.id]),
  )
  const newEventCount = events.filter(
    (event) => !eventIdsBySlug.has(event.row.slug),
  ).length

  // 1. Events first: the join rows need their ids. Skipped on a dry run, which
  //    is why a brand-new event plans its lineup against an empty id.
  if (!dryRun) {
    const { data: upserted, error: upsertError } = await supabase
      .from('events')
      .upsert(
        events.map((event) => event.row),
        { onConflict: 'slug' },
      )
      .select('id, slug')
    if (upsertError) {
      console.error('Failed to upsert events:', upsertError)
      process.exit(1)
    }
    for (const row of rows<IdSlugRow>(upserted)) {
      eventIdsBySlug.set(row.slug, row.id)
    }
  }

  // 2. Every brand slug in every file, in ONE query. No per-brand lookups, and
  //    deliberately no status filter — see the header.
  const brandSlugs = [
    ...new Set(
      events.flatMap((event) =>
        (event.brands ?? []).map((brand) => brand.slug),
      ),
    ),
  ]
  const brandIdsBySlug = new Map<string, string>()
  if (brandSlugs.length > 0) {
    const { data: brandRows, error: brandsError } = await supabase
      .from('brands')
      .select('id, slug')
      .in('slug', brandSlugs)
    if (brandsError) {
      console.error('Failed to resolve brand slugs:', brandsError)
      process.exit(1)
    }
    for (const row of rows<IdSlugRow>(brandRows)) {
      brandIdsBySlug.set(row.slug, row.id)
    }
  }

  // 3. The lineup that exists today, for the events that already exist.
  const knownEventIds = events
    .map((event) => eventIdsBySlug.get(event.row.slug))
    .filter((id): id is string => Boolean(id))
  const existingBrandIdsByEvent = new Map<string, string[]>()
  if (knownEventIds.length > 0) {
    const { data: joinRows, error: joinError } = await supabase
      .from('event_brands')
      .select('event_id, brand_id')
      .in('event_id', knownEventIds)
    if (joinError) {
      console.error('Failed to read existing lineups:', joinError)
      process.exit(1)
    }
    for (const row of rows<JoinRow>(joinRows)) {
      const bucket = existingBrandIdsByEvent.get(row.event_id) ?? []
      bucket.push(row.brand_id)
      existingBrandIdsByEvent.set(row.event_id, bucket)
    }
  }

  const plans = events.map((event) => {
    const eventId = eventIdsBySlug.get(event.row.slug) ?? ''
    return planEventSeed({
      eventSlug: event.row.slug,
      eventId,
      brands: event.brands,
      brandIdsBySlug,
      existingBrandIds: existingBrandIdsByEvent.get(eventId) ?? [],
    })
  })

  const unknownBrandSlugs = [
    ...new Set(plans.flatMap((plan) => plan.unknownBrandSlugs)),
  ]
  for (const plan of plans) {
    for (const slug of plan.unknownBrandSlugs) {
      console.warn(
        `[warn] ${plan.eventSlug}: no brand with slug "${slug}" — row skipped`,
      )
    }
  }

  const totals = plans.reduce(
    (acc, plan) => ({
      inserts: acc.inserts + plan.insertCount,
      updates: acc.updates + plan.updateCount,
      deletes: acc.deletes + plan.deleteBrandIds.length,
    }),
    { inserts: 0, updates: 0, deletes: 0 },
  )

  console.log('\n--- Plan ---')
  console.log(`Events:            ${events.length} (${newEventCount} new)`)
  console.log(`Lineup inserts:    ${totals.inserts}`)
  console.log(`Lineup updates:    ${totals.updates}`)
  console.log(`Lineup deletes:    ${totals.deletes}`)
  console.log(`Unknown brands:    ${unknownBrandSlugs.length}`)

  if (dryRun) {
    console.log('\nDry run complete. Nothing was written.')
    if (unknownBrandSlugs.length > 0) process.exitCode = 1
    return
  }

  // 4. Lineup upserts, one call for every event.
  const upsertRows = plans.flatMap((plan) => plan.upsertRows)
  if (upsertRows.length > 0) {
    const { error: linkError } = await supabase
      .from('event_brands')
      .upsert(upsertRows, { onConflict: 'event_id,brand_id' })
    if (linkError) {
      console.error('Failed to upsert lineup rows:', linkError)
      process.exit(1)
    }
  }

  // 5. Prune last, so a crash mid-run leaves an event with extra brands rather
  //    than with a lineup that was deleted and never rewritten.
  for (const plan of plans) {
    if (plan.deleteBrandIds.length === 0) continue
    const { error: deleteError } = await supabase
      .from('event_brands')
      .delete()
      .eq('event_id', plan.eventId)
      .in('brand_id', plan.deleteBrandIds)
    if (deleteError) {
      console.error(`Failed to prune lineup for ${plan.eventSlug}:`, deleteError)
      process.exit(1)
    }
  }

  // Out-of-Next ISR trigger: this process has no request context, so
  // revalidatePath does not exist here. Never throws — a misconfigured laptop
  // degrades to a warning and the writes above still stand.
  await requestEventRevalidation(events.map((event) => event.row.slug))

  console.log('\nDone.')
  if (unknownBrandSlugs.length > 0) {
    console.error(
      `Exiting non-zero: ${unknownBrandSlugs.length} unknown brand slug(s) — ${unknownBrandSlugs.join(', ')}`,
    )
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Seed script failed:', error)
    process.exit(1)
  })
}
