import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EVICTED_LABELS,
  L2_SUBCATEGORIES,
  OUT_OF_FRAME_LABELS,
  normalizeSubcategoryKey,
} from "@/lib/taxonomy/ontology";

import { validateDeploymentTarget, type DeploymentTarget } from "./db-deploy";
import {
  PRE_MIGRATION_CORPUS,
  assertStagingRehearsalTarget,
  forwardSubcategories,
  type PreMigrationCorpus,
} from "./rehearse-slug-reverse";

/**
 * DEV-1510 Task 9 — the forward backfill's planner, generator and dry run.
 *
 * `supabase/migrations/20260820130000_backfill_subcategory_slugs.sql` is the
 * authoritative transform. This file owns the two things a `.sql` file cannot
 * hold: the label map generated from `ontology.ts` (so the two cannot drift),
 * and a rehearsal that runs the real migration against real staging rows inside
 * a transaction that always rolls back.
 *
 * Usage (staging env must be sourced explicitly — `.env.local` is not it):
 *
 *   # dry run: rehearse the migration, roll back, report                (default)
 *   set -a && . ./.env.staging && set +a && pnpm exec tsx scripts/backfill-subcategory-slugs.ts
 *
 *   # regenerate the migration's generated blocks from the live ontology
 *   … scripts/backfill-subcategory-slugs.ts --emit
 *
 *   # apply for real, through the canonical applier that also stamps the ledger
 *   … scripts/backfill-subcategory-slugs.ts --apply
 *
 *   # re-apply ONLY the generated parts after --emit, once the migration has run
 *   … scripts/backfill-subcategory-slugs.ts --reseed
 *
 * RETAINED DELIBERATELY — do not delete this file as dead code. It has no TS
 * importer, so an import-graph scan reports it unreachable. Two APPLIED
 * migrations reference it by path, and one of them does so at RUNTIME:
 *
 *   - `20260820130000_backfill_subcategory_slugs.sql` raises an exception whose
 *     `hint` tells the operator to "re-run scripts/backfill-subcategory-slugs.ts
 *     --emit". Applied migrations cannot be edited in place, so that hint text
 *     is permanent.
 *   - `20260822090000_retire_crafts_l1.sql` cites this script as the provenance
 *     of its ~1000-line generated SQL block, and defers a known alias gap
 *     (永生花) to the next `--emit`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

export const MIGRATION_PATH =
  "supabase/migrations/20260820130000_backfill_subcategory_slugs.sql";

// ---------------------------------------------------------------------------
// The label map
// ---------------------------------------------------------------------------

export type LabelDisposition = "resolve" | "evicted" | "out-of-frame";

export type LabelMapRow = {
  labelKey: string;
  targetSlug: string | null;
  disposition: LabelDisposition;
};

/**
 * Every string the backfill accepts, keyed by `normalizeSubcategoryKey`.
 *
 * Four sources, in this precedence order:
 *   1. the L2 slug itself — the transform must be IDEMPOTENT. A second run, a
 *      row written by a post-deploy picker, and `approve_submission` reading a
 *      submission created after the deploy all hand it slugs, not labels.
 *   2. `nameZh` and `nameEn`
 *   3. every alias
 *   4. `EVICTED_LABELS` and `OUT_OF_FRAME_LABELS`, which resolve to a recorded
 *      REMOVAL rather than to a slug
 *
 * Anything outside this map raises. That is the whole safety property: a label
 * resolving to nothing is otherwise indistinguishable from one meant to be
 * evicted.
 */
export function buildLabelMap(): LabelMapRow[] {
  const rows = new Map<string, LabelMapRow>();
  const collisions: string[] = [];

  const claim = (
    key: string,
    targetSlug: string | null,
    disposition: LabelDisposition,
    source: string,
  ): void => {
    if (!key) return;
    const existing = rows.get(key);
    if (existing) {
      if (
        existing.targetSlug !== targetSlug ||
        existing.disposition !== disposition
      ) {
        collisions.push(
          `${key}: ${existing.disposition}/${existing.targetSlug ?? "-"} vs ${source} ${disposition}/${targetSlug ?? "-"}`,
        );
      }
      return;
    }
    rows.set(key, { labelKey: key, targetSlug, disposition });
  };

  for (const sub of L2_SUBCATEGORIES) {
    claim(normalizeSubcategoryKey(sub.slug), sub.slug, "resolve", "slug");
    claim(normalizeSubcategoryKey(sub.nameZh), sub.slug, "resolve", "nameZh");
    claim(normalizeSubcategoryKey(sub.nameEn), sub.slug, "resolve", "nameEn");
    for (const alias of sub.aliases) {
      claim(normalizeSubcategoryKey(alias), sub.slug, "resolve", "alias");
    }
  }
  for (const label of EVICTED_LABELS) {
    claim(normalizeSubcategoryKey(label), null, "evicted", "evicted");
  }
  for (const label of OUT_OF_FRAME_LABELS) {
    claim(normalizeSubcategoryKey(label), null, "out-of-frame", "out-of-frame");
  }

  if (collisions.length > 0) {
    throw new Error(
      `Label map collisions — one key cannot carry two dispositions:\n  ${collisions.join("\n  ")}`,
    );
  }
  return [...rows.values()].toSorted((a, b) =>
    a.labelKey < b.labelKey ? -1 : a.labelKey > b.labelKey ? 1 : 0,
  );
}

export const LABEL_MAP = buildLabelMap();

// ---------------------------------------------------------------------------
// The 34-row `體驗課程・DIY材料` triage
// ---------------------------------------------------------------------------

export const CRAFT_KIT_LABEL = "體驗課程・DIY材料";
export const CRAFT_KIT_SLUG = "craft-kits-and-supplies";

/**
 * The 10 brands that KEEP a craft-supplies tag, from
 * `docs/decisions/2026-08-19-cross-l1-read-fix-and-slug-migration-scope.md`
 * decision 4. The other 24 holders drop it, which is why the label sits in
 * `EVICTED_LABELS` as the default disposition rather than as an alias.
 *
 * Per-brand and explicit on purpose: a rule derived from a neighbouring column
 * would launder the editorial judgement behind a heuristic that mis-files the
 * next brand silently.
 *
 * `gshop` is load-bearing. Under a plain forward transform with no triage it is
 * a FIFTH zero-subcategory brand — the Wave 2 rollback rehearsal found it —
 * because `體驗課程・DIY材料` is its only surviving tag.
 */
export const CRAFT_KIT_KEEPERS: readonly string[] = [
  "1cmhandmake",
  "away-studio",
  "billnogates",
  "celebrate-today",
  "evies-drawing-daily",
  "gshop",
  "mr-sci-science-factory",
  "tobe-craft",
  "v-j-studio",
  "wooso",
];

const CRAFT_KIT_KEEPER_SET = new Set(CRAFT_KIT_KEEPERS);
const CRAFT_KIT_KEY = normalizeSubcategoryKey(CRAFT_KIT_LABEL);

/**
 * The forward transform for one row of `brands.subcategories`: the shared
 * strict model from the rollback rehearsal, plus the per-brand triage.
 *
 * The triage is deliberately NOT part of `forwardSubcategories`. Every other
 * surface — submissions, drafts, corrections, AI results — has no brand slug to
 * key it on and takes the default eviction.
 */
export function brandSubcategorySlugs(
  brandSlug: string,
  labels: readonly string[],
): string[] {
  const slugs = forwardSubcategories(labels);
  const keeps =
    CRAFT_KIT_KEEPER_SET.has(brandSlug) &&
    labels.some((label) => normalizeSubcategoryKey(label) === CRAFT_KIT_KEY);
  if (keeps && !slugs.includes(CRAFT_KIT_SLUG)) slugs.push(CRAFT_KIT_SLUG);
  return slugs;
}

// ---------------------------------------------------------------------------
// The zero-subcategory outcome
// ---------------------------------------------------------------------------

/**
 * The one brand for which reaching zero subcategories is the INTENDED result —
 * a hospitality brand leaving the directory through two `OUT_OF_FRAME_LABELS`.
 * Recorded separately so verification can tell a defect from a decision.
 */
export const INTENTIONAL_ZERO_BRANDS: readonly string[] = [
  "蟬說-漫步台灣-蟬說生活",
];

export type ZeroSubcategoryOutcome = {
  unintended: string[];
  intentional: string[];
};

export function zeroSubcategoryBrands(
  corpus: PreMigrationCorpus = PRE_MIGRATION_CORPUS,
): ZeroSubcategoryOutcome {
  const intentionalSet = new Set(INTENTIONAL_ZERO_BRANDS);
  const unintended: string[] = [];
  const intentional: string[] = [];
  for (const [brandSlug, labels] of Object.entries(corpus)) {
    if (brandSubcategorySlugs(brandSlug, labels).length > 0) continue;
    (intentionalSet.has(brandSlug) ? intentional : unintended).push(brandSlug);
  }
  return {
    unintended: unintended.toSorted(),
    intentional: intentional.toSorted(),
  };
}

// ---------------------------------------------------------------------------
// Generated SQL blocks and their parity check
// ---------------------------------------------------------------------------

const MAP_BLOCK = /-- >>> label map\n([\s\S]*?)-- <<< label map/;
const KEEPER_BLOCK =
  /-- >>> craft kit keepers\n([\s\S]*?)-- <<< craft kit keepers/;
const MAP_ROW = /^\s*\('((?:[^']|'')*)', (null|'[a-z0-9-]+'), '([a-z-]+)'\)[,;]?\s*$/;
const KEEPER_ROW = /^\s*\('((?:[^']|'')*)'\)[,;]?\s*$/;

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function unquote(value: string): string {
  return value.replace(/''/g, "'");
}

export function renderLabelMapBlock(rows: LabelMapRow[] = LABEL_MAP): string {
  return rows
    .map(
      (row, index) =>
        `  (${sqlLiteral(row.labelKey)}, ${
          row.targetSlug === null ? "null" : sqlLiteral(row.targetSlug)
        }, ${sqlLiteral(row.disposition)})${index === rows.length - 1 ? ";" : ","}`,
    )
    .join("\n");
}

/**
 * A VALUES list inside a subquery, NOT a statement — the last row carries no
 * terminator. A stray `;` here closes the enclosing UPDATE mid-expression and
 * the migration fails to parse.
 */
export function renderKeeperBlock(
  brandSlugs: readonly string[] = CRAFT_KIT_KEEPERS,
): string {
  return brandSlugs
    .map((brandSlug) => `              (${sqlLiteral(brandSlug)})`)
    .join(",\n");
}

/**
 * Reads the generated blocks back out of the migration. The migration is what
 * an operator runs with plain `psql` and no Node available, so it carries its
 * own copy of the label map; this parser is what stops that copy from drifting
 * away from `ontology.ts`. Same shape as the reverse migration's parser.
 */
export function parseMigrationTables(sql: string): {
  labelMap: LabelMapRow[];
  keepers: string[];
} {
  const mapBody = MAP_BLOCK.exec(sql)?.[1];
  const keeperBody = KEEPER_BLOCK.exec(sql)?.[1];
  if (!mapBody || !keeperBody) {
    throw new Error(
      "The backfill migration is missing a generated data block marker",
    );
  }

  const labelMap: LabelMapRow[] = [];
  for (const line of mapBody.split("\n")) {
    const match = MAP_ROW.exec(line);
    if (!match) continue;
    labelMap.push({
      labelKey: unquote(match[1] ?? ""),
      targetSlug: match[2] === "null" ? null : unquote(match[2]!.slice(1, -1)),
      disposition: (match[3] ?? "") as LabelDisposition,
    });
  }

  const keepers: string[] = [];
  for (const line of keeperBody.split("\n")) {
    const match = KEEPER_ROW.exec(line);
    if (!match) continue;
    keepers.push(unquote(match[1] ?? ""));
  }
  return { labelMap, keepers };
}

export function migrationSql(): string {
  return readFileSync(resolve(ROOT, MIGRATION_PATH), "utf8");
}

function emitGeneratedBlocks(): void {
  const sql = migrationSql();
  const next = sql
    .replace(
      MAP_BLOCK,
      `-- >>> label map\n${renderLabelMapBlock()}\n-- <<< label map`,
    )
    .replace(
      KEEPER_BLOCK,
      `-- >>> craft kit keepers\n${renderKeeperBlock()}\n-- <<< craft kit keepers`,
    );
  writeFileSync(resolve(ROOT, MIGRATION_PATH), next);
  console.log(
    `Regenerated ${MIGRATION_PATH}: ${LABEL_MAP.length} label rows, ${CRAFT_KIT_KEEPERS.length} keepers`,
  );
}

// ---------------------------------------------------------------------------
// Staging access
// ---------------------------------------------------------------------------

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
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(`psql failed: ${redact(result.stderr.trim())}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Re-exports the stored corpus from the live database. The plan requires this
 * immediately before the backfill runs rather than reusing the 2026-08-19
 * snapshot, because the catalogue grows: a spelling added after the snapshot is
 * exactly what the closed list would otherwise miss.
 */
export function exportCorpus(target: DeploymentTarget): PreMigrationCorpus {
  const { stdout } = psql(target, [
    "--command",
    "select slug || chr(9) || coalesce(array_to_json(subcategories)::text, '[]') from public.brands order by slug;",
  ]);
  const corpus: PreMigrationCorpus = {};
  for (const line of stdout.split("\n")) {
    const separator = line.indexOf("\t");
    if (separator === -1) continue;
    corpus[line.slice(0, separator)] = JSON.parse(
      line.slice(separator + 1),
    ) as string[];
  }
  return corpus;
}

export type CorpusAudit = {
  brands: number;
  tagUses: number;
  resolved: number;
  removed: number;
  unresolved: Array<{ label: string; brands: string[] }>;
};

export function auditCorpus(corpus: PreMigrationCorpus): CorpusAudit {
  const unresolved = new Map<string, string[]>();
  let tagUses = 0;
  let resolved = 0;
  let removed = 0;

  for (const [brandSlug, labels] of Object.entries(corpus)) {
    tagUses += labels.length;
    for (const label of labels) {
      const key = normalizeSubcategoryKey(label);
      const row = LABEL_MAP.find((entry) => entry.labelKey === key);
      if (!row) {
        unresolved.set(label, [...(unresolved.get(label) ?? []), brandSlug]);
      } else if (row.disposition === "resolve") {
        resolved += 1;
      } else if (key === CRAFT_KIT_KEY && CRAFT_KIT_KEEPER_SET.has(brandSlug)) {
        resolved += 1;
      } else {
        removed += 1;
      }
    }
  }

  return {
    brands: Object.keys(corpus).length,
    tagUses,
    resolved,
    removed,
    unresolved: [...unresolved.entries()].map(([label, brands]) => ({
      label,
      brands,
    })),
  };
}

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------

const DRY_RUN_PROBE = `
select 'FORMORIA_ZERO', slug
from public.brands
where status = 'approved' and coalesce(cardinality(subcategories), 0) = 0
order by slug;

select 'FORMORIA_LABELS', count(*)::text
from public.brands
where exists (
  select 1 from unnest(subcategories) as tag(value)
  where tag.value !~ '^[a-z0-9-]+$'
);

select 'FORMORIA_SLUGS', count(*)::text
from public.brands
where exists (
  select 1 from unnest(subcategories) as tag(value)
  where tag.value ~ '^[a-z0-9-]+$'
);
`;

function buildDryRunScript(): string {
  // The migration owns its own begin/commit. Swapping the trailing commit for a
  // rollback is what makes this a dry run against real rows rather than a model.
  const sql = migrationSql();
  const rolledBack = sql.replace(/\ncommit;\s*$/, "\n");
  if (rolledBack === sql) {
    throw new Error("The backfill migration does not end with `commit;`");
  }
  return `\\set ON_ERROR_STOP on\n${rolledBack}\n${DRY_RUN_PROBE}\nrollback;\n`;
}

const FINGERPRINT_SQL = `select count(*)::text || ' ' || coalesce(
  md5(string_agg(slug || '=' || array_to_string(subcategories, ',', ''), E'\\n' order by slug)),
  'empty'
) from public.brands;`;

function fingerprint(target: DeploymentTarget): string {
  return psql(target, ["--command", FINGERPRINT_SQL]).stdout.trim();
}

const MIGRATION_VERSION = "20260820130000";

/**
 * True once the migration is in the ledger. The transaction rehearsal is a
 * PRE-APPLY tool and cannot be repeated afterwards by design: site 7/7 asserts
 * `approve_submission`'s pre-patch md5, and re-running it against the patched
 * body must fail rather than re-patch a body that has already moved. Saying so
 * is better than surfacing a fingerprint error that reads like drift.
 */
function migrationIsApplied(target: DeploymentTarget): boolean {
  const { stdout } = psql(target, [
    "--command",
    `select count(*) from supabase_migrations.schema_migrations where version = '${MIGRATION_VERSION}';`,
  ]);
  return Number(stdout.trim()) > 0;
}

function dryRun(): void {
  const target = assertStagingRehearsalTarget();
  console.log(
    `Dry run of ${MIGRATION_PATH} against staging project ${target.projectRef}`,
  );

  const { labelMap, keepers } = parseMigrationTables(migrationSql());
  const parity: string[] = [];
  if (JSON.stringify(labelMap) !== JSON.stringify(LABEL_MAP)) {
    parity.push(
      `migration label map has ${labelMap.length} rows, ontology has ${LABEL_MAP.length} — run with --emit`,
    );
  }
  if (JSON.stringify(keepers) !== JSON.stringify([...CRAFT_KIT_KEEPERS])) {
    parity.push("migration craft-kit keepers differ from the ADR list");
  }

  const failures: string[] = [...parity];
  const exportedAt = new Date().toISOString();
  const live = exportCorpus(target);
  const liveAudit = auditCorpus(live);
  const committedAudit = auditCorpus(PRE_MIGRATION_CORPUS);
  const zero = zeroSubcategoryBrands();

  console.log(`corpus re-exported at:   ${exportedAt}`);
  console.log(
    `live rows:               ${liveAudit.brands} brands / ${liveAudit.tagUses} tag-uses`,
  );
  console.log(
    `committed corpus:        ${committedAudit.brands} brands / ${committedAudit.tagUses} tag-uses`,
  );
  console.log(
    `resolve / remove:        ${committedAudit.resolved} / ${committedAudit.removed}`,
  );
  console.log(`unresolved (live):       ${liveAudit.unresolved.length}`);
  console.log(`unresolved (committed):  ${committedAudit.unresolved.length}`);
  console.log(`zero unintended:         ${zero.unintended.join(", ") || "-"}`);
  console.log(`zero intentional:        ${zero.intentional.join(", ") || "-"}`);

  if (migrationIsApplied(target)) {
    console.log(
      `\n${MIGRATION_VERSION} is already in the ledger — the transaction rehearsal is a pre-apply step and is skipped.`,
    );
    console.log(
      "Use --reseed to re-apply the generated label map after --emit.",
    );
    if (failures.length > 0 || liveAudit.unresolved.length > 0) {
      console.error("\nAudit FAILED:");
      for (const failure of failures) console.error(`  ${failure}`);
      for (const entry of liveAudit.unresolved) {
        console.error(`  live label ${JSON.stringify(entry.label)} resolves to nothing`);
      }
      process.exitCode = 1;
      return;
    }
    console.log("Audit PASSED — every stored string resolves.");
    return;
  }

  const before = fingerprint(target);
  const workdir = mkdtempSync(join(tmpdir(), "slug-backfill-dryrun-"));
  const scriptPath = join(workdir, "dry-run.sql");
  writeFileSync(scriptPath, buildDryRunScript());

  const run = psql(target, ["--field-separator", "|", "--file", scriptPath]);
  const after = fingerprint(target);

  const zeroAfter: string[] = [];
  let residualLabelRows = "0";
  let slugRows = "0";
  for (const line of run.stdout.split("\n")) {
    const parts = line.split("|");
    if (parts[0] === "FORMORIA_ZERO") zeroAfter.push(parts[1] ?? "");
    if (parts[0] === "FORMORIA_LABELS") residualLabelRows = parts[1] ?? "0";
    if (parts[0] === "FORMORIA_SLUGS") slugRows = parts[1] ?? "0";
  }

  for (const notice of run.stderr.split("\n")) {
    if (notice.includes("NOTICE:")) console.log(notice.trim());
  }
  console.log(`brands holding slugs:    ${slugRows}`);
  console.log(`brands holding labels:   ${residualLabelRows}`);
  console.log(
    `staging zero after:      ${zeroAfter.filter(Boolean).join(", ") || "-"}`,
  );
  console.log(`fingerprint before:      ${before}`);
  console.log(`fingerprint after:       ${after}`);

  if (liveAudit.unresolved.length > 0) {
    for (const entry of liveAudit.unresolved) {
      failures.push(
        `live label ${JSON.stringify(entry.label)} resolves to nothing (${entry.brands.join(", ")})`,
      );
    }
  }
  if (committedAudit.unresolved.length > 0) {
    failures.push(
      `${committedAudit.unresolved.length} committed-corpus labels resolve to nothing`,
    );
  }
  if (Number(residualLabelRows) !== 0) {
    failures.push(`${residualLabelRows} brand(s) still hold zh-TW labels`);
  }
  if (after !== before) {
    failures.push(
      `staging changed: ${before} -> ${after} (the dry-run transaction did not roll back)`,
    );
  }

  if (failures.length > 0) {
    console.error("\nDry run FAILED:");
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "\nDry run PASSED — staging is byte-identical to how it started.",
  );
}

/**
 * Re-applies the two GENERATED parts of the migration — the label map rows and
 * the strict resolver — to a database that already has the migration in its
 * ledger.
 *
 * `supabase db push` will not re-run an applied migration, and this migration
 * cannot be re-run wholesale anyway: its `approve_submission` fingerprint
 * assertion is deliberately one-shot. But the label map is DECLARATIVE
 * (`delete` then `insert`, generated from `ontology.ts`), so an alias added
 * after the fact has a correct and repeatable path here. Both statements are
 * EXTRACTED FROM THE MIGRATION FILE rather than retyped, so the database and
 * the file cannot drift — which is the whole failure mode the twelve
 * hand-patched, source-file-less functions in this schema demonstrate.
 */
function reseed(): void {
  const target = assertStagingRehearsalTarget();
  const sql = migrationSql();

  const mapStatement =
    /delete from public\.subcategory_label_map;\n\ninsert into public\.subcategory_label_map[\s\S]*?-- <<< label map/.exec(
      sql,
    )?.[0];
  const resolver =
    /create or replace function public\.subcategory_labels_to_slugs\(p_labels text\[\]\)[\s\S]*?\n\$function\$;/.exec(
      sql,
    )?.[0];
  if (!mapStatement || !resolver) {
    throw new Error(
      "Could not extract the generated label map or the strict resolver from the migration",
    );
  }

  const workdir = mkdtempSync(join(tmpdir(), "slug-backfill-reseed-"));
  const scriptPath = join(workdir, "reseed.sql");
  writeFileSync(
    scriptPath,
    `\\set ON_ERROR_STOP on\nbegin;\n${mapStatement}\n\n${resolver}\n\nselect 'FORMORIA_ROWS', count(*)::text from public.subcategory_label_map;\ncommit;\n`,
  );

  const run = psql(target, ["--field-separator", "|", "--file", scriptPath]);
  const rows = run.stdout
    .split("\n")
    .find((line) => line.startsWith("FORMORIA_ROWS"))
    ?.split("|")[1];
  console.log(`Re-seeded subcategory_label_map: ${rows} rows`);
  if (Number(rows) !== LABEL_MAP.length) {
    console.error(
      `Expected ${LABEL_MAP.length} rows from the ontology, database has ${rows}`,
    );
    process.exitCode = 1;
  }
}

function apply(): void {
  // db-deploy is the canonical applier: it validates the target, runs the
  // ledger and regenerates database.types.ts. Re-implementing any of that here
  // would give the backfill a second, weaker deployment path.
  validateDeploymentTarget();
  const result = spawnSync(
    "pnpm",
    ["exec", "tsx", "scripts/db-deploy.ts", "migrate"],
    { cwd: ROOT, stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  if (args.has("--emit")) {
    emitGeneratedBlocks();
    return;
  }
  if (args.has("--reseed")) {
    reseed();
    return;
  }
  if (args.has("--apply")) {
    apply();
    return;
  }
  dryRun();
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
