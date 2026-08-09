import fs from 'fs';
import path from 'path';

/**
 * Creative Expo exhibitor facts, derived from the committed ledger.
 *
 * The expo spec used to hardcode two brand names, two booth numbers and a mirror of
 * the component's page size. Every one of those is a value that changes when the
 * roster is re-derived, so the spec had to be edited whenever the content moved —
 * the exact habit that trains people to edit tests instead of reading them
 * (DEV-1414).
 *
 * What this does and does not guard, stated plainly because the distinction matters
 * (see `project_expo-floor-map-geometry`): the ledger is the artifact the database
 * was seeded from, so asserting the rendered rows against it proves seed -> render
 * fidelity — a swapped label, a dropped row, a booth attached to the wrong brand.
 * It does NOT prove transcription fidelity from the official PDF, which has no text
 * layer and never had an automatic guard. That check stays human.
 */
export type ExpoExhibitor = {
  name: string;
  nameEn: string | null;
  booth: string;
  zone: string;
  brandSlug: string | null;
};

export const EXPO_SLUG = '2026-taiwan-creative-expo';

const LEDGER_PATH = path.join(
  process.cwd(),
  'content',
  'events',
  `${EXPO_SLUG}.exhibitors.json`,
);

function readLedger(): ExpoExhibitor[] {
  const raw = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')) as {
    exhibitors?: Array<Record<string, unknown>>;
  };
  const rows = raw.exhibitors ?? [];
  if (rows.length === 0) {
    // A ledger that parses to nothing would turn every assertion below into a
    // vacuous pass, so it fails here instead.
    throw new Error(`exhibitor ledger is empty: ${LEDGER_PATH}`);
  }
  return rows.map((row) => ({
    name: String(row.name ?? ''),
    nameEn: row.nameEn ? String(row.nameEn) : null,
    booth: String(row.booth ?? ''),
    zone: String(row.zone ?? ''),
    brandSlug: row.brandSlug ? String(row.brandSlug) : null,
  }));
}

export const EXHIBITORS = readLedger();

/**
 * Mirrors `CREATIVE_EXPO_ZONE_CODES` in `src/lib/events/creative-expo-explorer.ts`.
 * It cannot be imported: that module resolves through the `@/` alias, which the
 * Playwright transform does not configure, and pulling it in would drag the whole
 * component graph into a spec bundle.
 *
 * The mirror is self-checking rather than trusted — the first expo test compares the
 * rendered total against `RENDERED_EXHIBITORS.length`, so if the hall's zone list
 * changes here without changing there (or the reverse), that test fails naming both
 * numbers. The ledger currently carries two `J2` rows the explorer does not render.
 */
const CANONICAL_ZONES = new Set(["K1", "K2", "K3", "S"]);

/** The ledger rows the explorer actually renders — the roster a reader can see. */
export const RENDERED_EXHIBITORS = EXHIBITORS.filter((exhibitor) =>
  CANONICAL_ZONES.has(exhibitor.zone),
);

/** Rendered exhibitors with a brand page — the only rows that become internal links. */
export const LINKED_EXHIBITORS = RENDERED_EXHIBITORS.filter(
  (exhibitor) => exhibitor.brandSlug !== null,
);

/**
 * A stable, deterministic subject for the search-and-navigate journey: the linked
 * exhibitor with a romanization whose booth number sorts first. Picking by sort
 * rather than by index keeps the choice stable when rows are appended to the ledger.
 *
 * The romanization requirement is what lets the spec assert all three search index
 * paths — booth, Chinese name, romanization — unconditionally. Guarding the third
 * on `if (subject.nameEn)` would make the coverage depend on which row the sort
 * happened to pick, which is the same drift the fixture exists to remove.
 */
export const SEARCH_SUBJECT = [...LINKED_EXHIBITORS]
  .filter((exhibitor) => exhibitor.nameEn !== null)
  .sort((a, b) => a.booth.localeCompare(b.booth))[0]!;

/** Zone codes present in the rendered roster, with their exhibitor counts. */
export const ZONE_COUNTS: Record<string, number> = RENDERED_EXHIBITORS.reduce<
  Record<string, number>
>((counts, exhibitor) => {
  counts[exhibitor.zone] = (counts[exhibitor.zone] ?? 0) + 1;
  return counts;
}, {});

/**
 * Not every ledger zone earns a chip — the explorer renders only its canonical zone
 * codes, so a stray code in the data is deliberately unfiltered. Which codes those
 * are is read off the rendered chips rather than mirrored here; this only answers
 * "how many rows does the ledger put in that zone" once the spec has picked one.
 */
export function ledgerZoneCount(code: string): number {
  return ZONE_COUNTS[code] ?? 0;
}
