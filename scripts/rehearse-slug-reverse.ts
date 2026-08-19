import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EVICTED_LABELS,
  OUT_OF_FRAME_LABELS,
  matchSubcategory,
  normalizeSubcategoryKey,
  subcategoryBySlug,
} from "@/lib/taxonomy/ontology";

import { validateDeploymentTarget, type DeploymentTarget } from "./db-deploy";
import { STAGING_PROJECT_REF } from "./staging-target";

/**
 * Rehearses `supabase/migrations/reverse/20260820120000_revert_slug_storage.sql`
 * against staging, inside a transaction that always rolls back.
 *
 * The rollback is written and proven BEFORE the forward backfill (DEV-1510 task
 * 9) exists, so this file also carries a *model* of that forward transform:
 * labels resolve to slugs through the same ontology the migration will use, and
 * the model's output is what the reverse is fed. Task 9's migration remains
 * authoritative — when it lands, re-run this rehearsal against its output and
 * the two must agree row for row.
 *
 * Usage (staging env must be sourced explicitly — `.env.local` is not it):
 *   set -a && . ./.env.staging && set +a && pnpm exec tsx scripts/rehearse-slug-reverse.ts
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

export const REVERSE_MIGRATION_PATH =
  "supabase/migrations/reverse/20260820120000_revert_slug_storage.sql";

const CORPUS_PATH = resolve(HERE, "slug-reverse-corpus.json");

/**
 * `docs/` is gitignored, so `docs/reports/2026-08-19-taxonomy-pre-migration-corpus.csv`
 * — the artifact that makes an evicted label recoverable by hand — exists only
 * on the machine that exported it. This file is the committed, brand-keyed copy
 * of the same 2,446 stored strings, so the rollback's supporting evidence
 * survives a fresh clone.
 */
export type PreMigrationCorpus = Record<string, string[]>;

export const PRE_MIGRATION_CORPUS = JSON.parse(
  readFileSync(CORPUS_PATH, "utf8"),
) as PreMigrationCorpus;

const DROPPED_LABEL_KEYS = new Set(
  [...EVICTED_LABELS, ...OUT_OF_FRAME_LABELS].map(normalizeSubcategoryKey),
);

/**
 * A label the forward backfill deletes rather than converts. These are the two
 * declared sets and nothing else: a label that merely fails to resolve is a
 * backfill failure, not a deletion.
 */
export function isDroppedLabel(label: string): boolean {
  return DROPPED_LABEL_KEYS.has(normalizeSubcategoryKey(label));
}

/** The stored labels that survive the forward backfill, in stored order. */
export function survivingLabels(labels: readonly string[]): string[] {
  const kept: string[] = [];
  for (const label of labels) {
    if (isDroppedLabel(label)) continue;
    if (!kept.includes(label)) kept.push(label);
  }
  return kept;
}

/**
 * The rehearsal's model of the forward backfill: drop the evicted and
 * out-of-frame labels, resolve everything else through the ontology, dedupe on
 * first occurrence. Unresolvable input throws — matching task 9's contract that
 * an unknown string fails the backfill rather than disappearing from it.
 */
export function forwardSubcategories(labels: readonly string[]): string[] {
  const slugs: string[] = [];
  for (const label of labels) {
    if (isDroppedLabel(label)) continue;
    const match = matchSubcategory(label);
    if (!match) {
      throw new Error(
        `Stored label ${JSON.stringify(label)} resolves to no slug, alias or recorded removal`,
      );
    }
    if (!slugs.includes(match.slug)) slugs.push(match.slug);
  }
  return slugs;
}

/**
 * Slug-only reverse: every slug becomes its node's canonical zh-TW name. This
 * is correct in meaning for every row and exact for all but the 51 brands that
 * stored an alias spelling or two labels that collapsed onto one slug — those
 * are what the restoration overlay exists for.
 */
export function canonicalLabels(slugs: readonly string[]): string[] {
  return slugs.map((slug) => subcategoryBySlug(slug)?.nameZh ?? slug);
}

export type RestorationEntry = {
  brandSlug: string;
  expectedSlugs: string[];
  restoredLabels: string[];
};

/**
 * Per-brand exact restorations, derived from the corpus rather than hand-listed.
 * A brand earns an entry only when the slug-only reverse would not reproduce its
 * stored array — 51 of 795 brands, all of them alias spellings (`帆布包` for
 * `tote-bags`) or collisions (`雨傘` + `陽傘` both on `umbrellas`).
 *
 * `expectedSlugs` is a guard, not a key: the entry applies only while the brand
 * still carries exactly the slug set the forward backfill produced. A brand
 * re-tagged after the forward migration falls back to the slug-only reverse
 * instead of having an operator's edit silently reverted.
 */
export function buildRestorationOverlay(
  corpus: PreMigrationCorpus,
): RestorationEntry[] {
  const entries: RestorationEntry[] = [];
  for (const [brandSlug, labels] of Object.entries(corpus)) {
    const restoredLabels = survivingLabels(labels);
    if (restoredLabels.length === 0) continue;
    const expectedSlugs = forwardSubcategories(labels);
    if (
      JSON.stringify(canonicalLabels(expectedSlugs)) ===
      JSON.stringify(restoredLabels)
    ) {
      continue;
    }
    entries.push({ brandSlug, expectedSlugs, restoredLabels });
  }
  return entries.toSorted((a, b) => a.brandSlug.localeCompare(b.brandSlug));
}

export const RESTORATION_OVERLAY =
  buildRestorationOverlay(PRE_MIGRATION_CORPUS);

const OVERLAY_BY_BRAND = new Map(
  RESTORATION_OVERLAY.map((entry) => [entry.brandSlug, entry]),
);

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((value) => b.has(value));
}

/** The reverse transform the migration implements, in TypeScript. */
export function reverseSubcategories(
  brandSlug: string,
  slugs: readonly string[],
  overlay: ReadonlyMap<string, RestorationEntry> = OVERLAY_BY_BRAND,
): string[] {
  const entry = overlay.get(brandSlug);
  if (entry && sameSet(entry.expectedSlugs, slugs)) {
    return [...entry.restoredLabels];
  }
  return canonicalLabels(slugs);
}

// --- migration parity -------------------------------------------------------

const MAP_BLOCK = /-- >>> label map\n([\s\S]*?)\n-- <<< label map/;
const OVERLAY_BLOCK =
  /-- >>> restoration overlay\n([\s\S]*?)\n-- <<< restoration overlay/;
const MAP_ROW = /^\s*\('([^']*)', '((?:[^']|'')*)'\)[,;]?\s*$/;
const OVERLAY_ROW =
  /^\s*\('([^']*)', array\[(.*)\]::text\[\], array\[(.*)\]::text\[\]\)[,;]?\s*$/;

function unquote(value: string): string {
  return value.replace(/''/g, "'");
}

function sqlArray(body: string): string[] {
  const values: string[] = [];
  for (const match of body.matchAll(/'((?:[^']|'')*)'/g)) {
    values.push(unquote(match[1] ?? ""));
  }
  return values;
}

/**
 * Reads the two generated data blocks back out of the migration. The migration
 * is the artifact an operator runs with plain `psql` and no Node available, so
 * it carries its own copies of the label map and the restoration overlay; this
 * parser is what stops those copies from drifting away from the ontology.
 */
export function parseReverseMigrationTables(sql: string): {
  labelBySlug: Map<string, string>;
  restoration: RestorationEntry[];
} {
  const mapBody = MAP_BLOCK.exec(sql)?.[1];
  const overlayBody = OVERLAY_BLOCK.exec(sql)?.[1];
  if (!mapBody || !overlayBody) {
    throw new Error(
      "The reverse migration is missing a generated data block marker",
    );
  }

  const labelBySlug = new Map<string, string>();
  for (const line of mapBody.split("\n")) {
    const match = MAP_ROW.exec(line);
    if (!match) continue;
    labelBySlug.set(unquote(match[1] ?? ""), unquote(match[2] ?? ""));
  }

  const restoration: RestorationEntry[] = [];
  for (const line of overlayBody.split("\n")) {
    const match = OVERLAY_ROW.exec(line);
    if (!match) continue;
    restoration.push({
      brandSlug: unquote(match[1] ?? ""),
      expectedSlugs: sqlArray(match[2] ?? ""),
      restoredLabels: sqlArray(match[3] ?? ""),
    });
  }
  return { labelBySlug, restoration };
}

// --- deployment target ------------------------------------------------------

/**
 * Staging-only guard, layered on `validateDeploymentTarget` so the connection
 * string itself — not the declared environment name — decides which project is
 * being touched. A production ref reaches this function only as a rejection.
 */
export function assertStagingRehearsalTarget(
  environment: Record<string, string | undefined> = process.env,
): DeploymentTarget {
  const target = validateDeploymentTarget(environment);
  if (
    target.environment !== "staging" ||
    target.projectRef !== STAGING_PROJECT_REF
  ) {
    throw new Error(
      `The slug-reverse rehearsal runs against staging (${STAGING_PROJECT_REF}) only; refusing ${target.environment} project ${target.projectRef}`,
    );
  }
  return target;
}

// --- rehearsal --------------------------------------------------------------

type StagingRow = { brandSlug: string; subcategories: string[] };

/** Connection strings carry a password. Never let one reach stdout or a log. */
function redact(text: string): string {
  return text.replace(/postgres(?:ql)?:\/\/\S+/g, "postgresql://[redacted]");
}

function psql(
  target: DeploymentTarget,
  args: string[],
): { stdout: string; stderr: string } {
  const result = spawnSync(
    "psql",
    [
      "--dbname",
      target.databaseUrl,
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--set",
      "ON_ERROR_STOP=on",
      ...args,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`psql failed: ${redact(result.stderr.trim())}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

const FINGERPRINT_SQL = `select count(*)::text || ' ' || coalesce(
  md5(string_agg(slug || '=' || array_to_string(subcategories, ',', ''), E'\\n' order by slug)),
  'empty'
) from public.brands;`;

function fingerprint(target: DeploymentTarget): string {
  return psql(target, ["--command", FINGERPRINT_SQL]).stdout.trim();
}

function readStagingRows(target: DeploymentTarget): StagingRow[] {
  const { stdout: output } = psql(target, [
    "--command",
    "select slug || chr(9) || coalesce(array_to_json(subcategories)::text, '[]') from public.brands order by slug;",
  ]);
  if (!output.trim()) throw new Error("staging returned no brands to rehearse");
  const rows: StagingRow[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const separator = line.indexOf("\t");
    if (separator === -1) continue;
    rows.push({
      brandSlug: line.slice(0, separator),
      subcategories: JSON.parse(line.slice(separator + 1)) as string[],
    });
  }
  return rows;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlTextArray(values: readonly string[]): string {
  return `array[${values.map(sqlLiteral).join(", ")}]::text[]`;
}

function buildRehearsalScript(rows: StagingRow[]): string {
  const forwarded = rows.map(
    (row) =>
      `  (${sqlLiteral(row.brandSlug)}, ${sqlTextArray(forwardSubcategories(row.subcategories))})`,
  );
  const reverseMigration = readFileSync(
    resolve(ROOT, REVERSE_MIGRATION_PATH),
    "utf8",
  );

  return `\\set ON_ERROR_STOP on
begin;

-- Rehearsal model of the DEV-1510 task 9 forward backfill, computed in
-- TypeScript from the same ontology the migration will use. Rolled back below.
update public.brands b
set subcategories = f.slugs
from (values
${forwarded.join(",\n")}
) as f(brand_slug, slugs)
where b.slug = f.brand_slug and b.subcategories is distinct from f.slugs;

select 'FORMORIA_FORWARD', count(*)::text
from public.brands b
join (values
${forwarded.join(",\n")}
) as f(brand_slug, slugs) on b.slug = f.brand_slug
where b.subcategories = f.slugs;

-- ===== reverse migration under rehearsal, inlined verbatim =====
${reverseMigration}
-- ===== end reverse migration =====

select 'FORMORIA_ROW', slug, coalesce(array_to_json(subcategories)::text, '[]')
from public.brands order by slug;

rollback;
`;
}

function parseRehearsalOutput(output: string): {
  forwardApplied: number;
  rows: StagingRow[];
} {
  let forwardApplied = 0;
  const rows: StagingRow[] = [];
  for (const line of output.split("\n")) {
    const parts = line.split("|");
    if (parts[0] === "FORMORIA_FORWARD") {
      forwardApplied = Number(parts[1] ?? "0");
    } else if (parts[0] === "FORMORIA_ROW" && parts.length >= 3) {
      rows.push({
        brandSlug: parts[1] ?? "",
        subcategories: JSON.parse(parts.slice(2).join("|")) as string[],
      });
    }
  }
  return { forwardApplied, rows };
}

function main(): void {
  const target = assertStagingRehearsalTarget();
  console.log(
    `Rehearsing ${REVERSE_MIGRATION_PATH} against staging project ${target.projectRef}`,
  );

  const before = readStagingRows(target);
  const beforeFingerprint = fingerprint(target);
  const beforeBySlug = new Map(before.map((row) => [row.brandSlug, row]));

  const workdir = mkdtempSync(join(tmpdir(), "slug-reverse-rehearsal-"));
  const scriptPath = join(workdir, "rehearsal.sql");
  writeFileSync(scriptPath, buildRehearsalScript(before));

  const rehearsal = psql(target, [
    "--field-separator",
    "|",
    "--file",
    scriptPath,
  ]);
  const { forwardApplied, rows: after } = parseRehearsalOutput(
    rehearsal.stdout,
  );

  const failures: string[] = [];
  if (forwardApplied !== before.length) {
    failures.push(
      `forward model applied to ${forwardApplied} of ${before.length} brands`,
    );
  }
  if (after.length !== before.length) {
    failures.push(`row count moved ${before.length} -> ${after.length}`);
  }

  let overlayHits = 0;
  let evicted = 0;
  for (const row of after) {
    const original = beforeBySlug.get(row.brandSlug);
    if (!original) {
      failures.push(`${row.brandSlug}: appeared during the rehearsal`);
      continue;
    }
    const expected = survivingLabels(original.subcategories);
    const predicted = reverseSubcategories(
      row.brandSlug,
      forwardSubcategories(original.subcategories),
    );
    if (JSON.stringify(row.subcategories) !== JSON.stringify(expected)) {
      failures.push(
        `${row.brandSlug}: SQL restored ${JSON.stringify(row.subcategories)}, stored ${JSON.stringify(expected)}`,
      );
    }
    if (JSON.stringify(row.subcategories) !== JSON.stringify(predicted)) {
      failures.push(
        `${row.brandSlug}: SQL and TypeScript reverses disagree — ${JSON.stringify(row.subcategories)} vs ${JSON.stringify(predicted)}`,
      );
    }
    if (OVERLAY_BY_BRAND.has(row.brandSlug)) overlayHits += 1;
    evicted += original.subcategories.filter(isDroppedLabel).length;
  }

  const afterFingerprint = fingerprint(target);
  if (afterFingerprint !== beforeFingerprint) {
    failures.push(
      `staging changed: ${beforeFingerprint} -> ${afterFingerprint} (the rehearsal transaction did not roll back)`,
    );
  }

  console.log(`brands rehearsed:        ${before.length}`);
  console.log(`restoration overlay hits: ${overlayHits}`);
  console.log(`tag-uses dropped by eviction: ${evicted}`);
  for (const notice of rehearsal.stderr.split("\n")) {
    if (notice.includes("NOTICE:")) console.log(notice.trim());
  }
  console.log(`fingerprint before:      ${beforeFingerprint}`);
  console.log(`fingerprint after:       ${afterFingerprint}`);
  console.log(`generated script:        ${scriptPath}`);

  if (failures.length > 0) {
    console.error("\nRehearsal FAILED:");
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "\nRehearsal PASSED — staging is byte-identical to how it started.",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(
      redact(error instanceof Error ? error.message : String(error)),
    );
    process.exitCode = 1;
  }
}
