/**
 * Full read-only snapshot of a cohort's brands as they exist in production.
 *
 * Run once BEFORE the refresh and once AFTER. The "before" file is not only the
 * left-hand column of the comparison — it is the rollback copy. `select('*')`
 * is deliberate: a column added later must land in the backup without anyone
 * remembering to update a field list, because the whole point of this file is
 * to be able to put production back.
 *
 * Related rows are captured too (images, FAQs, channels, stockists), since the
 * refresh rewrites those as well and restoring only `brands` would leave the
 * brand pointing at images that no longer exist.
 *
 *   pnpm exec tsx scripts/curation-rerun/snapshot.ts --out before.json
 *   pnpm exec tsx scripts/curation-rerun/snapshot.ts --cohort batch1-never-curated --out before.json
 *
 * Staging is the default; pass --target production to run against production.
 */
import { writeFile, mkdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadCohort, snapshotDir } from "./cohort";
import { loadScriptTarget } from "../shared/target";

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv.at(index + 1);
}

async function refuseToClobber(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new Error(
    `refusing to overwrite ${path} — this may be the only backup. Pass a different --out`,
  );
}

/**
 * Child tables keyed by brand_id, with the columns to page by. Paging needs a
 * stable TOTAL order or rows shift between pages and the backup both
 * duplicates and drops — so the order columns must be unique per row, not
 * merely present. `brand_faq_entries` therefore takes its whole composite
 * primary key: it holds many rows per brand, unlike the single-row-per-brand
 * legacy table it replaced, where `brand_id` alone was already total.
 */
const CHILD_TABLES = [
  { table: "brand_images", orderBy: ["id"] },
  { table: "brand_faq_entries", orderBy: ["brand_id", "preset_id", "position"] },
  { table: "brand_channels", orderBy: ["id"] },
] as const;

/**
 * PostgREST caps a response at `max-rows` (1000 by default) and reports the cap
 * as an ordinary short result — no error, no flag. A 15-brand cohort never came
 * close, so this file read `select('*')` once and trusted the length. At 227
 * brands `brand_images` really holds 1078 rows and the snapshot silently kept
 * 1000, which for a file whose entire purpose is rollback means 78 images that
 * could not be restored. Always page to exhaustion; a short page ends it.
 */
const PAGE = 1000;

async function selectAllPages<T>(
  run: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

async function main(): Promise<void> {
  loadScriptTarget();
  const cohort = await loadCohort();
  const out = resolve(
    snapshotDir(cohort),
    argValue("--out") ?? `snapshot-${Date.now()}.json`,
  );
  await refuseToClobber(out);
  console.log(`cohort: ${cohort.name} (${cohort.slugs.length} brands)`);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const rows = await selectAllPages<Record<string, unknown>>((from, to) =>
    supabase
      .from("brands")
      .select("*")
      .in("slug", cohort.slugs)
      .order("id")
      .range(from, to),
  );
  if (rows.length !== cohort.slugs.length) {
    const found = new Set(rows.map((b) => (b as { slug: string }).slug));
    const missing = cohort.slugs.filter((s) => !found.has(s));
    // Hard failure: a partial "before" silently becomes a partial rollback.
    throw new Error(
      `only ${rows.length}/${cohort.slugs.length} brands found. Missing: ${missing.join(", ")}`,
    );
  }

  const ids = rows.map((b) => (b as { id: string }).id);
  const children: Record<string, unknown[]> = {};
  for (const { table, orderBy } of CHILD_TABLES) {
    let page: unknown[];
    try {
      page = await selectAllPages<unknown>((from, to) => {
        let query = supabase.from(table).select("*").in("brand_id", ids).order(
          orderBy[0],
        );
        for (const column of orderBy.slice(1)) query = query.order(column);
        return query.range(from, to);
      });
    } catch (childError) {
      // A missing table is fatal for a backup — better to know now than at restore.
      throw new Error(`${table}: ${JSON.stringify(childError)}`);
    }
    children[table] = page;
    console.log(`  ${table.padEnd(16)} ${page.length} row(s)`);
  }

  await mkdir(dirname(out), { recursive: true });
  await writeFile(
    out,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        cohort: cohort.name,
        slugs: cohort.slugs,
        brands: rows,
        children,
      },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${out}`);
  console.log(
    `  ${rows.length} brands, ${Object.values(children).reduce((n, r) => n + r.length, 0)} child rows`,
  );
}

void main().catch((e) => {
  console.error(
    "\nFAILED:",
    e instanceof Error ? e.message : JSON.stringify(e),
  );
  process.exitCode = 1;
});

export {};
