/**
 * @formoria-script
 * purpose: Compares prefix-only product-page text with relevance-aware evidence selection on sampled staging candidate pages (DEV-1855).
 * class: operator
 * invoke: pnpm exec tsx --env-file=.env.staging scripts/enrichment/products/curated-products/audit-evidence-selection.ts [--limit 100] [--out <dir>]
 * target: staging-default
 * safety: read-only
 * owner: engineering
 * prerequisites: .env.staging (the script refuses any Supabase project other than staging)
 * notes: Writes audit.csv and summary.md to --out (default: a fresh directory under os.tmpdir()).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setAuditWriteSeam } from "@/lib/audit";
import { mapWithConcurrency } from "@/lib/services/_shared/concurrency";
import { FACT_TIERS } from "@/lib/services/enrich-phases/products/evidence-lexicon";
import {
  MAX_MAIN_TEXT_CHARS,
  selectAcrossPages,
  type TextStats,
} from "@/lib/services/enrich-phases/products/select-evidence";
import { fetchHtmlWithMetadata } from "@/lib/services/enrich-phases/scraper/fetch-guards";
import { identifyPlatform } from "@/lib/services/enrich-phases/scraper/platforms";
import {
  extractMainTextBlocks,
  extractRenderedMainText,
} from "@/lib/services/enrich-phases/scraper/product-origin-text";
import { assertDatabaseTarget } from "@/lib/supabase/project-target";
import { createServiceClient } from "@/lib/supabase/service";

import { fetchAllRows } from "./shared";

/**
 * Staging audit: prefix-only text vs relevance-aware selection (DEV-1855).
 *
 *   pnpm exec tsx --env-file=.env.staging \
 *     scripts/enrichment/products/curated-products/audit-evidence-selection.ts \
 *     [--limit 100] [--out <dir>]
 *
 * READ-ONLY: one paged SELECT on curated_product_candidates, then plain HTML
 * fetches (no render, no model calls). The audit write seam is replaced with a
 * no-op so the guarded fetch never writes an external_call_audit row.
 *
 * Sampling: product-detail candidate URLs, deduplicated per brand, grouped by
 * brand so `selectAcrossPages` sees sibling pages (cross-page repeat removal
 * needs >= 3 pages), then round-robin across platforms (`identifyPlatform(url)`)
 * until ~--limit URLs are chosen.
 *
 * Per page:
 *   old  = extractRenderedMainText(html).slice(0, 4096)   (the pre-DEV-1855 prefix)
 *   new  = extractMainTextBlocks(html) -> selectAcrossPages over the brand group
 *   full = blocks.join(' ')
 * Fact-label hits = total FACT_TIERS pattern matches in each text.
 */

const DEFAULT_LIMIT = 100;
/**
 * Pages sampled per brand. Six gives the cross-page repeat rule (>= 3 pages and
 * >= half) room to fire while still spreading ~100 URLs over ~17 brands.
 */
const PAGES_PER_BRAND = 6;
const FETCH_CONCURRENCY = 4;
const UNKNOWN_PLATFORM = "generic";

type CandidateRow = {
  id: string;
  brand_id: string;
  job_id: string | null;
  url: string;
  normalized_url: string;
};

type SampledPage = {
  brandId: string;
  jobId: string | null;
  platform: string;
  url: string;
};

type PageResult = {
  brandId: string;
  jobId: string | null;
  platform: string;
  url: string;
  status: number | null;
  fetchError: string | null;
  fullChars: number;
  oldChars: number;
  newChars: number;
  truncatedOld: boolean;
  truncatedNew: boolean;
  boilerplateChars: number;
  hitsFull: number;
  hitsOld: number;
  hitsNew: number;
};

type PlatformSummary = {
  platform: string;
  sampled: number;
  fetchFailures: number;
  pages: number;
  truncatedOld: number;
  hitsFull: number;
  hitsOld: number;
  hitsNew: number;
  boilerplateChars: number;
  /** Truncated-old pages where new hits <= old hits. */
  truncatedNewNotBetter: number;
  /** Of those, pages where old missed labels present in full (recoverable). */
  truncatedRecoverableMissed: number;
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readFlag(argv: readonly string[], name: string): string | null {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  if (index === -1) return null;
  const value = argv.at(index + 1);
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseArgs(argv: readonly string[]): { limit: number; outDir: string } {
  const rawLimit = readFlag(argv, "--limit");
  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error(`--limit must be a positive integer, got ${rawLimit}`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir =
    readFlag(argv, "--out") ?? join(tmpdir(), `audit-evidence-selection-${stamp}`);
  return { limit, outDir };
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

function platformOf(url: string): string {
  return identifyPlatform(url) ?? UNKNOWN_PLATFORM;
}

/**
 * Deterministic: rows arrive ordered by id (a random uuid), so the first URLs
 * per brand and the brand order within a platform are an unbiased, repeatable
 * sample.
 */
function sampleByPlatform(
  rows: readonly CandidateRow[],
  limit: number,
): SampledPage[][] {
  const brandPages = new Map<string, SampledPage[]>();
  const brandSeen = new Map<string, Set<string>>();
  for (const row of rows) {
    const seen = brandSeen.get(row.brand_id) ?? new Set<string>();
    brandSeen.set(row.brand_id, seen);
    if (seen.has(row.normalized_url)) continue;
    seen.add(row.normalized_url);
    const pages = brandPages.get(row.brand_id) ?? [];
    brandPages.set(row.brand_id, pages);
    if (pages.length >= PAGES_PER_BRAND) continue;
    pages.push({
      brandId: row.brand_id,
      jobId: row.job_id,
      platform: platformOf(row.url),
      url: row.url,
    });
  }

  // A brand's platform is the platform of its first sampled URL.
  const brandsByPlatform = new Map<string, SampledPage[][]>();
  for (const pages of brandPages.values()) {
    const first = pages.at(0);
    if (!first) continue;
    const list = brandsByPlatform.get(first.platform) ?? [];
    brandsByPlatform.set(first.platform, list);
    list.push(pages);
  }

  const queues = [...brandsByPlatform.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, brands]) => [...brands]);
  const groups: SampledPage[][] = [];
  let total = 0;
  while (total < limit && queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      if (total >= limit) break;
      const brand = queue.shift();
      if (!brand) continue;
      groups.push(brand);
      total += brand.length;
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

const GLOBAL_TIER_PATTERNS = FACT_TIERS.map(
  ({ pattern }) =>
    new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`),
);

function countFactHits(text: string): number {
  let hits = 0;
  for (const pattern of GLOBAL_TIER_PATTERNS) {
    hits += text.match(pattern)?.length ?? 0;
  }
  return hits;
}

type Fetched = {
  page: SampledPage;
  status: number | null;
  fetchError: string | null;
  html: string | null;
};

async function fetchPage(page: SampledPage): Promise<Fetched> {
  try {
    const result = await fetchHtmlWithMetadata(page.url);
    const ok =
      result.text !== null &&
      result.status !== null &&
      result.status >= 200 &&
      result.status < 300;
    return {
      page,
      status: result.status,
      fetchError: ok ? null : (result.error ?? `status ${String(result.status)}`),
      html: ok ? result.text : null,
    };
  } catch (error) {
    return {
      page,
      status: null,
      fetchError: error instanceof Error ? error.message : String(error),
      html: null,
    };
  }
}

function failedResult(f: Fetched): PageResult {
  return {
    brandId: f.page.brandId,
    jobId: f.page.jobId,
    platform: f.page.platform,
    url: f.page.url,
    status: f.status,
    fetchError: f.fetchError,
    fullChars: 0,
    oldChars: 0,
    newChars: 0,
    truncatedOld: false,
    truncatedNew: false,
    boilerplateChars: 0,
    hitsFull: 0,
    hitsOld: 0,
    hitsNew: 0,
  };
}

/** Measures one brand group; selection runs across the group's fetched pages. */
function measureGroup(fetched: readonly Fetched[]): PageResult[] {
  const ok = fetched.filter(
    (f): f is Fetched & { html: string } => f.html !== null,
  );
  const withBlocks: Array<{
    url: string;
    mainText: string;
    blocks: string[];
    textStats?: TextStats;
  }> = ok.map((f) => ({
    url: f.page.url,
    mainText: "",
    blocks: extractMainTextBlocks(f.html),
  }));
  const selected = selectAcrossPages(withBlocks);

  const results: PageResult[] = fetched
    .filter((f) => f.html === null)
    .map(failedResult);

  ok.forEach((f, index) => {
    const blocks = withBlocks[index]?.blocks ?? [];
    const pick = selected[index];
    const full = blocks.join(" ");
    const old = extractRenderedMainText(f.html).slice(0, MAX_MAIN_TEXT_CHARS);
    const next = pick?.mainText ?? "";
    const stats: TextStats | undefined = pick?.textStats;
    results.push({
      brandId: f.page.brandId,
      jobId: f.page.jobId,
      platform: f.page.platform,
      url: f.page.url,
      status: f.status,
      fetchError: null,
      fullChars: full.length,
      oldChars: old.length,
      newChars: next.length,
      truncatedOld: full.length > MAX_MAIN_TEXT_CHARS,
      truncatedNew: stats?.truncated ?? false,
      boilerplateChars: stats?.boilerplateChars ?? 0,
      hitsFull: countFactHits(full),
      hitsOld: countFactHits(old),
      hitsNew: countFactHits(next),
    });
  });
  return results;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function summarize(results: readonly PageResult[]): PlatformSummary[] {
  const byPlatform = new Map<string, PlatformSummary>();
  const empty = (platform: string): PlatformSummary => ({
    platform,
    sampled: 0,
    fetchFailures: 0,
    pages: 0,
    truncatedOld: 0,
    hitsFull: 0,
    hitsOld: 0,
    hitsNew: 0,
    boilerplateChars: 0,
    truncatedNewNotBetter: 0,
    truncatedRecoverableMissed: 0,
  });
  const add = (s: PlatformSummary, r: PageResult) => {
    s.sampled++;
    if (r.fetchError !== null) {
      s.fetchFailures++;
      return;
    }
    s.pages++;
    s.hitsFull += r.hitsFull;
    s.hitsOld += r.hitsOld;
    s.hitsNew += r.hitsNew;
    s.boilerplateChars += r.boilerplateChars;
    if (r.truncatedOld) {
      s.truncatedOld++;
      if (r.hitsNew <= r.hitsOld) {
        s.truncatedNewNotBetter++;
        if (r.hitsOld < r.hitsFull) s.truncatedRecoverableMissed++;
      }
    }
  };
  const total = empty("ALL");
  for (const r of results) {
    const s = byPlatform.get(r.platform) ?? empty(r.platform);
    byPlatform.set(r.platform, s);
    add(s, r);
    add(total, r);
  }
  return [
    ...[...byPlatform.values()].sort((a, b) => a.platform.localeCompare(b.platform)),
    total,
  ];
}

function pct(numerator: number, denominator: number): string {
  return denominator === 0 ? "n/a" : `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function renderMarkdown(summaries: readonly PlatformSummary[], brands: number): string {
  const lines = [
    "# Evidence selection audit (DEV-1855)",
    "",
    `Generated ${new Date().toISOString()} against staging. Brands sampled: ${brands}.`,
    "",
    `old = extractRenderedMainText prefix (${MAX_MAIN_TEXT_CHARS} chars); new = selectAcrossPages; full = all blocks.`,
    "Hits = FACT_TIERS label matches. Recall = hits / full hits.",
    "",
    "| platform | sampled | fetch failed | pages | % truncated old | hits full | hits old | hits new | recall old | recall new | boilerplate chars removed | truncated: new <= old | of those, old missed labels |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const s of summaries) {
    lines.push(
      `| ${s.platform} | ${s.sampled} | ${s.fetchFailures} | ${s.pages} | ${pct(s.truncatedOld, s.pages)} | ${s.hitsFull} | ${s.hitsOld} | ${s.hitsNew} | ${pct(s.hitsOld, s.hitsFull)} | ${pct(s.hitsNew, s.hitsFull)} | ${s.boilerplateChars} | ${s.truncatedNewNotBetter} (${pct(s.truncatedNewNotBetter, s.truncatedOld)}) | ${s.truncatedRecoverableMissed} |`,
    );
  }
  lines.push(
    "",
    "Pivot trigger (plan Known Unknowns): new <= prefix on more than 10% of truncated pages.",
    "",
  );
  return lines.join("\n");
}

function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function renderCsv(results: readonly PageResult[]): string {
  const header = [
    "brand_id",
    "job_id",
    "platform",
    "url",
    "status",
    "fetch_error",
    "full_chars",
    "old_chars",
    "new_chars",
    "truncated_old",
    "truncated_new",
    "boilerplate_chars",
    "hits_full",
    "hits_old",
    "hits_new",
  ];
  const rows = results.map((r) =>
    [
      r.brandId,
      r.jobId,
      r.platform,
      r.url,
      r.status,
      r.fetchError,
      r.fullChars,
      r.oldChars,
      r.newChars,
      r.truncatedOld,
      r.truncatedNew,
      r.boilerplateChars,
      r.hitsFull,
      r.hitsOld,
      r.hitsNew,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { limit, outDir } = parseArgs(process.argv.slice(2));

  // Fails closed before any query: .env.local points at production.
  const { projectRef } = assertDatabaseTarget("staging");
  console.log(`[target] staging (${projectRef})`);

  // Guarded fetches go through auditedCall; keep this run write-free.
  setAuditWriteSeam(async () => null);

  const supabase = createServiceClient();
  const rows = await fetchAllRows<CandidateRow>(
    "curated_product_candidates",
    (from, to) =>
      supabase
        .from("curated_product_candidates")
        .select("id, brand_id, job_id, url, normalized_url")
        .eq("url_class", "product-detail")
        .order("id", { ascending: true })
        .range(from, to),
  );
  console.log(`[audit] ${rows.length} product-detail candidate rows`);

  const groups = sampleByPlatform(rows, limit);
  const sampledCount = groups.reduce((n, g) => n + g.length, 0);
  console.log(`[audit] sampled ${sampledCount} URLs across ${groups.length} brands`);

  const results: PageResult[] = [];
  let done = 0;
  for (const group of groups) {
    const fetched = await mapWithConcurrency(group, FETCH_CONCURRENCY, fetchPage);
    results.push(...measureGroup(fetched));
    done += group.length;
    console.log(`[audit] fetched ${done}/${sampledCount}`);
  }

  const summaries = summarize(results);
  mkdirSync(outDir, { recursive: true });
  const csvPath = join(outDir, "audit.csv");
  const mdPath = join(outDir, "summary.md");
  const markdown = renderMarkdown(summaries, groups.length);
  writeFileSync(csvPath, renderCsv(results));
  writeFileSync(mdPath, markdown);

  console.log(`\n${markdown}`);
  console.log(`[audit] wrote ${csvPath}`);
  console.log(`[audit] wrote ${mdPath}`);
}

// Guard: only fire main() when this file IS the process entry point.
if (process.argv[1]?.endsWith("curated-products/audit-evidence-selection.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
