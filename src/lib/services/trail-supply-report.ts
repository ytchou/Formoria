import {
  getPublishedCuratedProductsForTrail,
  type CuratedProductSupabase,
} from "@/lib/services/curated-products";
import { unplacedSectionKeys } from "@/lib/services/trail-authoring";
import { getAllTrailsForAdmin, type TrailLocale } from "@/lib/services/trails";
import { createServiceClient } from "@/lib/supabase/service";

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
 */
export type TrailSupplyOrphanReason = "unknown_trail" | "undeclared_section";

/** An active placement row that renders on no surface at all. */
export type TrailSupplyOrphanedSelection = {
  trailSlug: string;
  sectionKey: string;
  reason: TrailSupplyOrphanReason;
};

/**
 * The whole contract between this app and the nightly health-agent detector.
 *
 * `readUnavailable` is the load-bearing field: `true` means the run observed
 * nothing and the caller must emit ZERO findings. `trailsObserved` and
 * `selectionsObserved` exist so a clean run ("looked at 1 trail and 9
 * selections, found nothing") is distinguishable from a dormant one ("looked at
 * nothing") without reading logs.
 */
export type TrailSupplyReport = {
  readUnavailable: boolean;
  trailsObserved: number;
  selectionsObserved: number;
  emptySections: TrailSupplyEmptySection[];
  orphanedSelections: TrailSupplyOrphanedSelection[];
};

/** The narrowest shape of a trail this report reads. */
type TrailSupplySection = { key: string; title?: string };

type TrailSupplyTrail = {
  slug: string;
  frontmatter: { draft?: boolean; sections: readonly TrailSupplySection[] };
};

type TrailSupplyTrailList =
  | { ok: true; trails: readonly TrailSupplyTrail[] }
  | { ok: false };

/** The narrowest shape of a placed product this report reads. */
type TrailSupplyPlacement = { sectionKey?: string | null };

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
  readTrailPlacements: (trailSlug) =>
    getPublishedCuratedProductsForTrail(trailSlug),
  selectionsClient: () =>
    createServiceClient() as unknown as CuratedProductSupabase,
};

let activeDeps: TrailSupplyReportDeps = PRODUCTION_DEPS;

/**
 * Replaces the injected reads for the duration of a test; `null` restores the
 * production ones. Used by the cron route's test, which cannot pass arguments
 * through an HTTP handler. Always reset it in an `afterEach`.
 */
export function setTrailSupplyReportDepsForTests(
  overrides: Partial<TrailSupplyReportDeps> | null,
): void {
  activeDeps = overrides
    ? { ...PRODUCTION_DEPS, ...overrides }
    : PRODUCTION_DEPS;
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
};

function unavailableReport(): TrailSupplyReport {
  return {
    readUnavailable: true,
    trailsObserved: 0,
    selectionsObserved: 0,
    emptySections: [],
    orphanedSelections: [],
  };
}

/**
 * Every ACTIVE placement row, paged to the first short page.
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
      .select("product_id, trail_slug, section_key")
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
 */
export async function loadTrailSupplyReport(
  overrides?: Partial<TrailSupplyReportDeps>,
): Promise<TrailSupplyReport> {
  const deps = overrides ? { ...activeDeps, ...overrides } : activeDeps;

  const trails = await deps.readTrails("zh-TW");
  if (!trails.ok) return unavailableReport();

  const declaredByTrail = new Map<string, readonly TrailSupplySection[]>();
  for (const entry of trails.trails) {
    declaredByTrail.set(entry.slug, entry.frontmatter.sections);
  }

  const emptySections: TrailSupplyEmptySection[] = [];
  for (const entry of trails.trails) {
    // A draft promises nothing yet, so it cannot have broken a promise.
    if (entry.frontmatter.draft) continue;

    let placements: readonly TrailSupplyPlacement[];
    try {
      placements = await deps.readTrailPlacements(entry.slug);
    } catch {
      return unavailableReport();
    }

    for (const sectionKey of unplacedSectionKeys({
      frontmatter: entry.frontmatter,
      products: placements,
    })) {
      const declared = entry.frontmatter.sections.find(
        (section) => section.key === sectionKey,
      );
      emptySections.push({
        trailSlug: entry.slug,
        sectionKey,
        // The title is what the visitor actually reads above the empty space,
        // so the report names it; the key alone means nothing to the founder.
        sectionTitle: declared?.title ?? sectionKey,
      });
    }
  }

  let selections: ActiveSelectionRow[];
  try {
    selections = await readActiveSelections(deps.selectionsClient());
  } catch {
    return unavailableReport();
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
    orphaned.set(`${row.trail_slug}\u0000${row.section_key}`, {
      trailSlug: row.trail_slug,
      sectionKey: row.section_key,
      reason,
    });
  }

  return {
    readUnavailable: false,
    trailsObserved: trails.trails.length,
    selectionsObserved: selections.length,
    emptySections,
    orphanedSelections: [...orphaned.values()].sort(
      (a, b) =>
        a.trailSlug.localeCompare(b.trailSlug) ||
        a.sectionKey.localeCompare(b.sectionKey),
    ),
  };
}
