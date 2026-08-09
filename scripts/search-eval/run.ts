/**
 * Search relevance harness (DEV-1413).
 *
 * Runs the real public search RPC over a hand-labelled fixture and reports whether
 * each invariant holds. Read-only: it calls `search_brand_page` and reads `brands`,
 * and writes nothing back.
 *
 * The point of `--baseline` is to capture today's behavior BEFORE a relevance change,
 * so the change can be shown to be an improvement rather than a different kind of wrong.
 *
 *   pnpm search:eval              # run the fixture, print the table
 *   pnpm search:eval --baseline   # run and store as the comparison point
 *   pnpm search:eval --compare    # run and diff against the stored baseline
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServiceClient } from "@/lib/supabase/service";

const HERE = dirname(fileURLToPath(import.meta.url));
const QUERIES_PATH = join(HERE, "queries.json");
const RUNS_DIR = join(HERE, "runs");
const BASELINE_PATH = join(RUNS_DIR, "baseline.json");

/** Mirrors the page size hardcoded in `search_brand_page`. */
const RPC_PAGE_SIZE = 12;

interface FixtureCase {
  q: string;
  note?: string;
  mustInclude?: string[];
  mustExclude?: string[];
  minResults?: number;
  expectEmpty?: boolean;
}

interface CaseResult {
  q: string;
  totalCount: number;
  /** Slugs on page 1 only — `mustInclude` is checked against the full match set, not this. */
  topSlugs: string[];
  missing: string[];
  forbidden: string[];
  failures: string[];
}

type Supabase = ReturnType<typeof createServiceClient>;

async function readQueries(): Promise<FixtureCase[]> {
  const parsed = JSON.parse(await readFile(QUERIES_PATH, "utf8")) as {
    cases: FixtureCase[];
  };
  return parsed.cases;
}

/**
 * Paginates the RPC to completion. `mustInclude` is a recall claim about the whole
 * match set, so checking only page 1 would fail cases that are correct but rank low.
 */
async function collectMatches(
  supabase: Supabase,
  query: string,
): Promise<{ ids: string[]; totalCount: number }> {
  const ids: string[] = [];
  let totalCount = 0;

  for (let offset = 0; ; offset += RPC_PAGE_SIZE) {
    const { data, error } = await supabase.rpc("search_brand_page", {
      search_query: query,
      page_offset: offset,
      sort_mode: "rank",
    });
    if (error) throw new Error(`search_brand_page("${query}"): ${error.message}`);

    const rows = (data ?? []) as Array<{ id: string; total_count: number }>;
    if (rows.length === 0) break;

    totalCount = Number(rows[0]?.total_count ?? 0);
    for (const row of rows) ids.push(row.id);
    if (ids.length >= totalCount) break;
  }

  return { ids, totalCount };
}

async function slugsForIds(supabase: Supabase, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("brands").select("id, slug").in("id", ids);
  if (error) throw new Error(`brand slug lookup: ${error.message}`);
  return new Map((data ?? []).map((row) => [row.id as string, row.slug as string]));
}

function evaluate(fixture: FixtureCase, slugs: string[], totalCount: number): CaseResult {
  const found = new Set(slugs);
  const missing = (fixture.mustInclude ?? []).filter((slug) => !found.has(slug));
  const forbidden = (fixture.mustExclude ?? []).filter((slug) => found.has(slug));
  const failures: string[] = [];

  if (fixture.expectEmpty && totalCount > 0) {
    failures.push(`expected no results, got ${totalCount}`);
  }
  if (fixture.minResults !== undefined && totalCount < fixture.minResults) {
    failures.push(`expected at least ${fixture.minResults}, got ${totalCount}`);
  }
  if (missing.length > 0) failures.push(`missing: ${missing.join(", ")}`);
  if (forbidden.length > 0) failures.push(`must not match: ${forbidden.join(", ")}`);

  return {
    q: fixture.q,
    totalCount,
    topSlugs: slugs.slice(0, 5),
    missing,
    forbidden,
    failures,
  };
}

async function runFixture(): Promise<CaseResult[]> {
  const supabase = createServiceClient();
  const fixtures = await readQueries();
  const results: CaseResult[] = [];

  for (const fixture of fixtures) {
    const { ids, totalCount } = await collectMatches(supabase, fixture.q);
    const slugById = await slugsForIds(supabase, ids);
    const slugs = ids.map((id) => slugById.get(id) ?? id);
    results.push(evaluate(fixture, slugs, totalCount));
  }

  return results;
}

function report(results: CaseResult[]) {
  console.info("\nquery                 total  status");
  console.info("-".repeat(72));
  for (const result of results) {
    const status = result.failures.length === 0 ? "PASS" : `FAIL — ${result.failures.join("; ")}`;
    console.info(`${result.q.padEnd(20)}  ${String(result.totalCount).padStart(5)}  ${status}`);
  }
  const failed = results.filter((result) => result.failures.length > 0).length;
  console.info(`\n${results.length - failed}/${results.length} cases pass.`);
  return failed;
}

async function compare(results: CaseResult[]) {
  let baseline: CaseResult[];
  try {
    baseline = JSON.parse(await readFile(BASELINE_PATH, "utf8")) as CaseResult[];
  } catch {
    console.error(`No baseline at ${BASELINE_PATH}. Run with --baseline first.`);
    process.exitCode = 1;
    return;
  }

  const before = new Map(baseline.map((result) => [result.q, result]));
  console.info("\nquery                 before   after  delta");
  console.info("-".repeat(72));
  let regressions = 0;

  for (const result of results) {
    const prior = before.get(result.q);
    if (!prior) {
      console.info(`${result.q.padEnd(20)}       —  ${String(result.totalCount).padStart(6)}  new case`);
      continue;
    }
    const delta = result.totalCount - prior.totalCount;
    // A count moving is expected and is not itself a regression — the fixture's
    // invariants decide correctness. Only a case that passed and now fails is one.
    const regressed = prior.failures.length === 0 && result.failures.length > 0;
    if (regressed) regressions += 1;
    const marker = regressed ? "  REGRESSED" : "";
    const sign = delta > 0 ? `+${delta}` : String(delta);
    console.info(
      `${result.q.padEnd(20)}  ${String(prior.totalCount).padStart(6)}  ${String(result.totalCount).padStart(6)}  ${sign.padStart(5)}${marker}`,
    );
  }

  if (regressions > 0) {
    console.error(`\n${regressions} case(s) regressed against the baseline.`);
    process.exitCode = 1;
  } else {
    console.info("\nNo regressions against the baseline.");
  }
}

async function main() {
  const results = await runFixture();
  const failed = report(results);

  await mkdir(RUNS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(join(RUNS_DIR, `${stamp}.json`), JSON.stringify(results, null, 2));

  if (process.argv.includes("--baseline")) {
    await writeFile(BASELINE_PATH, JSON.stringify(results, null, 2));
    console.info(`\nBaseline written to ${BASELINE_PATH}`);
    return;
  }

  if (process.argv.includes("--compare")) {
    await compare(results);
    return;
  }

  if (failed > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
