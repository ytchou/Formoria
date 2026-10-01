import {
  getPublishedCuratedProductsForTrail,
  type CuratedProductSupabase,
} from "@/lib/services/curated-products";
import { unplacedSectionKeys } from "@/lib/services/trail-authoring";
import { getAllTrailsForAdmin, type TrailLocale } from "@/lib/services/trails";
import { createServiceClient } from "@/lib/supabase/service";
import { pickNoteKey } from "@/lib/trails/note-key";

/**
 * Nightly supply-decay observation for discovery trails (DEV-1520).
 *
 * REPORT ONLY. Nothing here reaches a public surface: a decayed trail stays
 * published, indexed, in the sitemap, on the hub, and on the homepage exactly
 * as before. DEV-1518 removed the render-time `min_products` / `empty_section`
 * 404 on purpose — supply adequacy is a publish decision the founder owns, not
 * a threshold in code — and this file must never grow it back. It answers one
 * question once a night: which published trail promises a slate it no longer
 * has, and which placement rows point at nothing.
 * See docs/decisions/2026-08-20-trail-supply-decay-is-reported-not-enforced.md.
 *
 * Two decay paths exist, and they are not symmetric:
 *
 *   - a DECLARED section whose products all went away (retired, link broken,
 *     brand unapproved) still renders its MDX heading and the prose promising a
 *     slate, with nothing under it;
 *   - a SELECTION row pointing at a trail slug or section key that no longer
 *     exists in any MDX file renders nowhere at all. `trail_slug` carries no
 *     foreign key and no CHECK constraint, so nothing in Postgres prevents it.
 */

/** One declared section of a published trail that currently has no products. */
export type TrailSupplyEmptySection = {
  trailSlug: string;
  sectionKey: string;
  sectionTitle: string;
};

/**
 * `unknown_trail` — no MDX file carries this slug (renamed, unpublished file,
 * deleted trail). `undeclared_section` — the trail exists but no longer
 * declares this section key.
 *
 * Deliberately not exported: it is reachable through
 * `TrailSupplyOrphanedSelection`, and the health-agent detector re-validates
 * the two literals itself rather than importing them
 * (`scripts/health-agent/trail-supply.ts`). Exporting it made it the only
 * unused export this feature introduced.
 */
type TrailSupplyOrphanReason = "unknown_trail" | "undeclared_section";

/** An active placement row that renders on no surface at all. */
export type TrailSupplyOrphanedSelection = {
  trailSlug: string;
  sectionKey: string;
  reason: TrailSupplyOrphanReason;
};

/**
 * Note drift in one section of a published trail (DEV-1903). `productKeys` are
 * `${brandSlug}/${productKey}`, the key the frontmatter `notes` record uses,
 * sorted. Grouped per section for the same reason orphaned selections are: one
 * section is one thing for a human to fix.
 *
 *   - `unnotedPlacements` — eligible (rendered) products placed in the section
 *     with no pick note;
 *   - `orphanedNotes` — notes whose product has no ACTIVE SELECTION there. A
 *     product that is still selected but temporarily ineligible (link broken,
 *     brand unapproved) keeps its note: it is not "no longer placed".
 *
 * Both are REPORT ONLY. An unnoted product still renders; an orphaned note
 * simply renders nowhere.
 */
export type TrailSupplyNoteDrift = {
  trailSlug: string;
  sectionKey: string;
  productKeys: string[];
};

/**
 * The whole contract between this app and the nightly health-agent detector.
 *
 * `readUnavailable` is the load-bearing field: `true` means the run observed
 * nothing and the caller must emit ZERO findings. `trailsObserved` and
 * `selectionsObserved` exist so a clean run ("looked at 1 trail and 9
 * selections, found nothing") is distinguishable from a dormant one ("looked at
 * nothing") without reading logs.
 *
 * `trailsObserved` counts the trails the empty-section pass actually EXAMINED,
 * which is the published ones. Drafts are skipped by that pass on purpose, so
 * counting them would break the very distinction the field exists to make: a
 * tree of five drafts would claim five observations having checked none. Drafts
 * are still read — the orphan diff runs against the full on-disk set — they are
 * just not part of what was examined for a broken promise.
 */
export type TrailSupplyReport = {
  readUnavailable: boolean;
  trailsObserved: number;
  selectionsObserved: number;
  emptySections: TrailSupplyEmptySection[];
  orphanedSelections: TrailSupplyOrphanedSelection[];
  unnotedPlacements: TrailSupplyNoteDrift[];
  orphanedNotes: TrailSupplyNoteDrift[];
};

/** The narrowest shape of a trail this report reads. */
type TrailSupplySection = {
  key: string;
  title?: string;
  notes?: Readonly<Record<string, string>>;
};

type TrailSupplyTrail = {
  slug: string;
  frontmatter: { draft?: boolean; sections: readonly TrailSupplySection[] };
};

type TrailSupplyTrailList =
  | { ok: true; trails: readonly TrailSupplyTrail[] }
  | { ok: false };

/** The narrowest shape of a placed product this report reads. */
type TrailSupplyPlacement = {
  sectionKey?: string | null;
  brandSlug: string;
  key: string;
};

/**
 * The three reads, injectable so both this service's tests and the cron route's
 * tests can drive it without mocking a module —
 * `scripts/check-test-boundaries.mjs` forbids `vi.mock` of `@/lib/services/*`,
 * `@/lib/supabase/*`, and `@supabase/*`.
 *
 * `selectionsClient` is a FACTORY, not a client: `createServiceClient()` reads
 * env at call time and must not run at module load.
 */
export type TrailSupplyReportDeps = {
  readTrails: (locale: TrailLocale) => Promise<TrailSupplyTrailList>;
  readTrailPlacements: (
    trailSlug: string,
  ) => Promise<readonly TrailSupplyPlacement[]>;
  selectionsClient: () => CuratedProductSupabase;
};

const PRODUCTION_DEPS: TrailSupplyReportDeps = {
  // The ADMIN read, drafts included. Drafts are excluded from the empty-section
  // pass below, but they must stay in the on-disk set the orphan diff runs
  // against: placements are prepared before publication, and reading published
  // trails only would report every one of those rows as an orphan.
  readTrails: (locale) => getAllTrailsForAdmin(locale),
  // CEILING: this read is UNPAGED. `getPublishedCuratedProductsForTrail` issues
  // one `.select()` with no `.range()`, so PostgREST clamps it silently at
  // `max_rows = 1000` (`supabase/config.toml`). Above 1000 published placement
  // rows on a single trail the tail never arrives, and the sections it supplied
  // are reported as empty — INVENTED decay, not missed decay, which is the
  // failure direction `SELECTION_PAGE_SIZE` below exists to prevent on the
  // other read. Sound only below that ceiling; the pilot trail is nowhere near
  // it. UPGRADE PATH: page that read the way `readActiveSelections` does, or
  // derive the empty-section verdict from the already-paged selections read
  // instead of a second trail-scoped one. Not done here because
  // `getPublishedCuratedProductsForTrail` is shipped code serving the public
  // `/discover/[slug]` page, and this branch changes no public read path.
  readTrailPlacements: (trailSlug) =>
    getPublishedCuratedProductsForTrail(trailSlug),
  selectionsClient: () =>
    createServiceClient() as unknown as CuratedProductSupabase,
};

let activeDeps: TrailSupplyReportDeps = PRODUCTION_DEPS;

/**
 * Thrown when a test installs a PARTIAL seam and the report reaches a dependency
 * the test never stubbed. It is re-thrown out of the `catch` blocks below
 * instead of degrading to `readUnavailable`, because a swallowed seam error is a
 * test that goes green while asserting the wrong thing.
 */
class TrailSupplyTestSeamError extends Error {
  constructor(name: keyof TrailSupplyReportDeps) {
    super(
      `trail-supply-report test seam is active but \`${name}\` was not stubbed. ` +
        `Stub it in setTrailSupplyReportDepsForTests, or clear the seam with null. ` +
        `Falling through to the production dependency would run a live read against real credentials.`,
    );
    this.name = "TrailSupplyTestSeamError";
  }
}

function unstubbed(name: keyof TrailSupplyReportDeps): never {
  throw new TrailSupplyTestSeamError(name);
}

/**
 * Replaces the injected reads for the duration of a test; `null` restores the
 * production ones exactly. THE CANONICAL SEAM — `loadTrailSupplyReport` takes no
 * arguments, so this is the only way to drive it from a test, and both the cron
 * route's test (which cannot pass arguments through an HTTP handler) and this
 * service's own test go through it.
 *
 * A dependency the caller does not stub does NOT fall back to production: it
 * throws. Merging over `PRODUCTION_DEPS` meant a test that stubbed only
 * `readTrails` reached `createServiceClient()` — a live Supabase call, against
 * whatever `.env` vitest loaded, swallowed by a `catch` into a green
 * `readUnavailable: true`. Always reset it in an `afterEach`.
 */
export function setTrailSupplyReportDepsForTests(
  overrides: Partial<TrailSupplyReportDeps> | null,
): void {
  if (!overrides) {
    activeDeps = PRODUCTION_DEPS;
    return;
  }

  activeDeps = {
    readTrails: overrides.readTrails ?? (() => unstubbed("readTrails")),
    readTrailPlacements:
      overrides.readTrailPlacements ?? (() => unstubbed("readTrailPlacements")),
    selectionsClient:
      overrides.selectionsClient ?? (() => unstubbed("selectionsClient")),
  };
}

/**
 * Rows per request, deliberately under the `max_rows = 1000` ceiling in
 * `supabase/config.toml`. At that ceiling PostgREST truncates the response with
 * NO error, and a truncated selection read is the worst possible input here: a
 * row that never arrives looks exactly like a placement that does not exist, so
 * a silent `db-max-rows` cut would publish a report full of invented decay.
 */
const SELECTION_PAGE_SIZE = 500;

/**
 * A hard stop on the paging loop. Reaching it means the pages are not advancing
 * (an unstable order, a proxy dropping `Range`), and looping forever inside a
 * nightly job is the worse failure. Throwing keeps this read's contract: it
 * returns every active row or it raises. It never returns a partial set.
 */
const SELECTION_MAX_PAGES = 200;

type ActiveSelectionRow = {
  product_id: string;
  trail_slug: string;
  section_key: string;
  /** Many-to-one embed; read only to build the note key. */
  curated_products?: {
    key: string;
    brands: { slug: string } | null;
  } | null;
};

/** `${trailSlug}\u0000${sectionKey}` — neither can contain `\u0000`. */
function sectionId(trailSlug: string, sectionKey: string): string {
  return `${trailSlug}\u0000${sectionKey}`;
}

/** Note keys of every active selection, grouped by trail + section. */
function selectedNoteKeysBySection(
  selections: readonly ActiveSelectionRow[],
): Map<string, Set<string>> {
  const bySection = new Map<string, Set<string>>();
  for (const row of selections) {
    const productKey = row.curated_products?.key;
    const brandSlug = row.curated_products?.brands?.slug;
    if (!productKey || !brandSlug) continue;
    const id = sectionId(row.trail_slug, row.section_key);
    const keys = bySection.get(id) ?? new Set<string>();
    keys.add(pickNoteKey(brandSlug, productKey));
    bySection.set(id, keys);
  }
  return bySection;
}

function unavailableReport(): TrailSupplyReport {
  return {
    readUnavailable: true,
    trailsObserved: 0,
    selectionsObserved: 0,
    emptySections: [],
    orphanedSelections: [],
    unnotedPlacements: [],
    orphanedNotes: [],
  };
}

/**
 * A loggable label for a failed read. Never the message: a PostgREST error can
 * echo row values, and this line goes to the deploy log. A Supabase error is a
 * plain object rather than an `Error`, so its `code` is the only thing that
 * separates schema lag from a 429 or a socket reset.
 */
function readFailureLabel(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const { code } = err as { code: unknown };
    if (typeof code === "string" && code) return code;
  }
  return err instanceof Error ? err.name : "UnknownError";
}

/**
 * The declared title for a key the empty-section pass just produced.
 *
 * Both exits are honest about their reachability. The loop ALWAYS matches:
 * `unplacedSectionKeys` returns keys it read off this very array, so the old
 * `declared?.title` optional chain guarded nothing and read like a guard. The
 * `?? sectionKey` inside it exists only because the narrow local
 * `TrailSupplySection` admits a missing title — `trails.ts:85` always writes a
 * string (possibly `''`) — and the trailing `return` exists only because
 * TypeScript cannot see that the loop must match. Neither is a defect handler.
 */
function sectionTitle(
  sections: readonly TrailSupplySection[],
  sectionKey: string,
): string {
  for (const section of sections) {
    if (section.key === sectionKey) return section.title ?? sectionKey;
  }
  return sectionKey;
}

/**
 * Diffs each declared section's `notes` against what is in it: unnoted against
 * the ELIGIBLE placements (what renders), orphaned against the ACTIVE
 * SELECTIONS (what is still placed, rendered or not). Diffing orphans against
 * eligible placements would call a still-selected product's note orphaned the
 * night its link breaks.
 *
 * Only DECLARED sections are examined: a placement in an undeclared section is
 * already an orphaned selection, and reporting it again as unnoted would file
 * the same breakage twice. A section with no `notes` reads as `{}`.
 */
function noteDrift(
  trailSlug: string,
  sections: readonly TrailSupplySection[],
  placements: readonly TrailSupplyPlacement[],
  selectedBySection: ReadonlyMap<string, ReadonlySet<string>>,
): { unnoted: TrailSupplyNoteDrift[]; orphaned: TrailSupplyNoteDrift[] } {
  const placedBySection = new Map<string, Set<string>>();
  for (const placement of placements) {
    if (!placement.sectionKey) continue;
    const placed = placedBySection.get(placement.sectionKey) ?? new Set();
    placed.add(pickNoteKey(placement.brandSlug, placement.key));
    placedBySection.set(placement.sectionKey, placed);
  }

  const unnoted: TrailSupplyNoteDrift[] = [];
  const orphaned: TrailSupplyNoteDrift[] = [];
  for (const section of sections) {
    const noted = new Set(Object.keys(section.notes ?? {}));
    const placed = placedBySection.get(section.key) ?? new Set<string>();
    const selected =
      selectedBySection.get(sectionId(trailSlug, section.key)) ??
      new Set<string>();

    const unnotedKeys = [...placed].filter((key) => !noted.has(key)).sort();
    if (unnotedKeys.length > 0) {
      unnoted.push({
        trailSlug,
        sectionKey: section.key,
        productKeys: unnotedKeys,
      });
    }

    const orphanedKeys = [...noted].filter((key) => !selected.has(key)).sort();
    if (orphanedKeys.length > 0) {
      orphaned.push({
        trailSlug,
        sectionKey: section.key,
        productKeys: orphanedKeys,
      });
    }
  }

  return { unnoted, orphaned };
}

/**
 * Every ACTIVE placement row, paged to the first short page, with the product
 * key and brand slug embedded for the note-drift diff. The embeds are LEFT
 * joins on purpose: an `!inner` would drop a row from `selectionsObserved`
 * and from the orphaned-selection diff.
 *
 * `.order()` before `.range()` is load-bearing, not cosmetic: without a total
 * order the same row can appear on two pages and another on none. The primary
 * key `(product_id, trail_slug, section_key)` is total, so ordering on it is
 * stable across requests.
 */
async function readActiveSelections(
  client: CuratedProductSupabase,
): Promise<ActiveSelectionRow[]> {
  const rows: ActiveSelectionRow[] = [];

  for (let page = 0; page < SELECTION_MAX_PAGES; page += 1) {
    const from = page * SELECTION_PAGE_SIZE;
    const { data, error } = await client
      .from("curated_product_selections")
      .select(
        "product_id, trail_slug, section_key, curated_products(key, brands(slug))",
      )
      .eq("state", "active")
      .order("product_id", { ascending: true })
      .order("trail_slug", { ascending: true })
      .order("section_key", { ascending: true })
      .range(from, from + SELECTION_PAGE_SIZE - 1);

    if (error) throw error;

    const pageRows = (data ?? []) as unknown as ActiveSelectionRow[];
    rows.push(...pageRows);
    if (pageRows.length < SELECTION_PAGE_SIZE) return rows;
  }

  throw new Error(
    `Trail selection read did not terminate after ${SELECTION_MAX_PAGES} pages`,
  );
}

/**
 * Observes trail supply once and reports what it found.
 *
 * EVERY failed read short-circuits to `readUnavailable: true` with empty
 * findings, and that guard is the most important line in the file. The nightly
 * run can execute against a checkout with no `content/trails/` directory at
 * all, where the trail read throws ENOENT (`trails.ts:180`). Without the guard
 * the on-disk trail set is empty, every active selection diffs as
 * `unknown_trail`, and an orphan storm becomes the normal nightly state. The
 * same reasoning covers the placement read: `curated_products` is a stub in
 * production and throws `42703` / `PGRST205` rather than returning `[]`
 * (`curated-products.ts:552-562`), so zero rows would read as "every section
 * lost its slate".
 *
 * AN EMPTY TRAIL LIST IS UNOBSERVABLE, NOT EVIDENCE. `getAllTrailsForAdmin`
 * returns `{ ok: true, trails: [] }` — not an error — when `content/trails/`
 * exists but holds no `.mdx`, and `content/trails/.gitkeep` is TRACKED, so that
 * state survives deleting every trail file and is exactly what a checkout of a
 * branch without the content looks like. `ok: true` alone would let the orphan
 * storm through the guard by the front door.
 */
export async function loadTrailSupplyReport(): Promise<TrailSupplyReport> {
  const deps = activeDeps;

  const trails = await deps.readTrails("zh-TW");
  if (!trails.ok || trails.trails.length === 0) return unavailableReport();

  const declaredByTrail = new Map<string, readonly TrailSupplySection[]>();
  for (const entry of trails.trails) {
    declaredByTrail.set(entry.slug, entry.frontmatter.sections);
  }

  const emptySections: TrailSupplyEmptySection[] = [];
  const unnotedPlacements: TrailSupplyNoteDrift[] = [];
  const orphanedNotes: TrailSupplyNoteDrift[] = [];
  // Note drift needs the active selections, which are read after this loop.
  const placementsByTrail: Array<{
    entry: TrailSupplyTrail;
    placements: readonly TrailSupplyPlacement[];
  }> = [];
  // Counts what the pass EXAMINED, which is what `trailsObserved` reports.
  let publishedExamined = 0;
  for (const entry of trails.trails) {
    // A draft promises nothing yet, so it cannot have broken a promise.
    if (entry.frontmatter.draft) continue;
    publishedExamined += 1;

    let placements: readonly TrailSupplyPlacement[];
    try {
      placements = await deps.readTrailPlacements(entry.slug);
    } catch (err) {
      if (err instanceof TrailSupplyTestSeamError) throw err;
      // Without this line a 429, an auth failure, a socket reset and by-design
      // dormancy are byte-identical in the artifact, in the response, AND in
      // the logs. The return value is deliberately unchanged: this adds
      // observability, it decides nothing.
      console.error(
        JSON.stringify({
          event: "trail_supply_placement_read_failed",
          trailSlug: entry.slug,
          error: readFailureLabel(err),
        }),
      );
      return unavailableReport();
    }

    for (const sectionKey of unplacedSectionKeys({
      frontmatter: entry.frontmatter,
      products: placements,
    })) {
      emptySections.push({
        trailSlug: entry.slug,
        sectionKey,
        // The title is what the visitor actually reads above the empty space,
        // so the report names it; the key alone means nothing to the founder.
        // No `?? sectionKey` fallback: `unplacedSectionKeys` returns keys it
        // read off THIS frontmatter, so the lookup cannot miss. A fallback here
        // would read as a missing-title guard while being unreachable.
        sectionTitle: sectionTitle(entry.frontmatter.sections, sectionKey),
      });
    }

    // Drafts never reach this line, so their notes are never examined either.
    placementsByTrail.push({ entry, placements });
  }

  let selections: ActiveSelectionRow[];
  try {
    selections = await readActiveSelections(deps.selectionsClient());
  } catch (err) {
    if (err instanceof TrailSupplyTestSeamError) throw err;
    // Covers the `SELECTION_MAX_PAGES` throw above as well as any Supabase
    // failure: without it the one guard that stops a partial read from
    // publishing invented decay is invisible when it fires.
    console.error(
      JSON.stringify({
        event: "trail_supply_selection_read_failed",
        error: readFailureLabel(err),
      }),
    );
    return unavailableReport();
  }

  const selectedBySection = selectedNoteKeysBySection(selections);
  for (const { entry, placements } of placementsByTrail) {
    const drift = noteDrift(
      entry.slug,
      entry.frontmatter.sections,
      placements,
      selectedBySection,
    );
    unnotedPlacements.push(...drift.unnoted);
    orphanedNotes.push(...drift.orphaned);
  }

  // Keyed by trail + section, because the finding is about the PLACEMENT, not
  // the product: ten products stranded in one dropped section are one thing to
  // fix, not ten identical findings. `selectionsObserved` still counts rows.
  const orphaned = new Map<string, TrailSupplyOrphanedSelection>();
  for (const row of selections) {
    const declared = declaredByTrail.get(row.trail_slug);
    const reason: TrailSupplyOrphanReason | null = !declared
      ? "unknown_trail"
      : declared.some((section) => section.key === row.section_key)
        ? null
        : "undeclared_section";
    if (reason === null) continue;

    // `\u0000` cannot occur in a slug or a section key, so the pair
    // never collides with a single value containing the separator.
    orphaned.set(sectionId(row.trail_slug, row.section_key), {
      trailSlug: row.trail_slug,
      sectionKey: row.section_key,
      reason,
    });
  }

  return {
    readUnavailable: false,
    // The trails EXAMINED, not the trails read: drafts are skipped above.
    trailsObserved: publishedExamined,
    selectionsObserved: selections.length,
    emptySections,
    orphanedSelections: [...orphaned.values()].sort(
      (a, b) =>
        a.trailSlug.localeCompare(b.trailSlug) ||
        a.sectionKey.localeCompare(b.sectionKey),
    ),
    unnotedPlacements,
    orphanedNotes,
  };
}
