/**
 * DEV-1310 cohort scan: capture page evidence and identify legacy zero-token
 * purchase websites that a high-confidence site-identity verdict says the
 * brand does not own.
 *
 *   CURATION_EVAL_SINK=$PWD/scripts/site-identity-eval/runs/dev-1310-cohort-scan.jsonl \
 *   pnpm exec tsx --env-file=.env.local scripts/site-identity-eval/cohort-scan.ts \
 *     --out scripts/site-identity-eval/runs/dev-1310-cohort-scan.json
 *
 * `CURATION_EVAL_SINK` is read at module load by code under `src/`, so it must
 * be set on the command line — setting it from inside this file is too late.
 *
 * That sink alone is NOT enough, and assuming it was cost a polluted audit
 * trail once: it diverts `insertAiCallResult` (LLM usage) only, while every
 * `auditedCall` envelope — `fetch_html`, `fetch_xml`, `scrape_url`,
 * `arbitrateSiteIdentity` — writes straight to `external_call_audit`. A 5-brand
 * smoke run left 92 production rows behind. So this script also installs an
 * audit write seam (`setAuditWriteSeam`) that appends those records to the same
 * JSONL file instead. Both diversions must be live before the first fetch, or a
 * read-only report silently forges enrichment activity in the table that cost
 * tracking and the DEV-1310 gate queries both read.
 *
 * Page evidence is captured before arbitration. An empty evidence object is
 * UNSCOREABLE: sending it to the arbiter would turn a fetch failure into a
 * model decision and could clear a link that was never judged. The arbiter
 * chunks internally, so the complete scoreable item array is passed in one call.
 * This report always exits 0 because it is evidence for an operator, not a gate.
 */
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  arbitrateSiteIdentity,
  siteIdentityKey,
  type SiteIdentityItem,
  type SiteIdentityVerdict,
} from "@/lib/services/site-identity-arbiter";
import { resolveQuarantine } from "@/lib/services/enrich-phases/site-identity";
import {
  scrapeBrandUrls,
  type MultiScrapeResult,
} from "@/lib/services/enrich-phases/scraper";
import { brandNameTokens, pageKeyHost } from "@/lib/services/link-enrichment";
import { setAuditWriteSeam, type AuditRecord } from "@/lib/audit";
import { resolveProfileModel } from "@/lib/constants/llm-models";
import { createServiceClient } from "@/lib/supabase/service";
import type { ScrapedBrandData } from "@/lib/types/scraper";

const BATCH_SIZE = 500;
// Four concurrent scrapes bound the wall clock for an ~88-brand report; this is
// a throughput limit, not a promise that the external fetches cost nothing.
const SCRAPE_CONCURRENCY = 4;
const DEFAULT_OUT = "scripts/site-identity-eval/runs/dev-1310-cohort-scan.json";

type BrandRow = {
  id: string;
  slug: string;
  name: string | null;
  category: string | null;
  purchase_website: string | null;
};
type Evidence = { title?: string; description?: string; story?: string };
type Unscoreable = {
  slug: string;
  brandName: string;
  url: string;
  reason: string;
};
type ScanRow = {
  slug: string;
  brandName: string;
  url: string;
  verdict: boolean | null;
  confidence: SiteIdentityVerdict["confidence"] | null;
  reason: string | null;
  evidencePresent: boolean;
  decision: "clear" | "keep" | "unscoreable";
};

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv.at(index + 1);
}

function printHelp(): void {
  console.log(
    `Usage:\n  CURATION_EVAL_SINK=<path.jsonl> pnpm exec tsx --env-file=.env.local scripts/site-identity-eval/cohort-scan.ts [--out <path>] [--limit <n>]\n\nOptions:\n  --out <path>   JSON report path (default: ${DEFAULT_OUT})\n  --limit <n>    scan at most n cohort brands\n  --help         print this help without touching Supabase or the network`,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The evidence the arbiter judges, derived the way `buildQuarantine` derives it
 * in the links phase for a `website` subject: per-source text first, matched BY
 * HOST because a website owns its whole domain, then the merged fields as the
 * fallback for a page whose text won the merge but left no per-source entry.
 * Mirrored rather than imported — `textForSubject` is private to `links.ts`, and
 * that file is deployed code this task must not touch.
 *
 * Empty and whitespace values are dropped rather than passed as `""`, because
 * the number of keys left is exactly what makes a brand scoreable below.
 */
function evidenceFrom(data: ScrapedBrandData, subjectUrl: string): Evidence {
  const byHost: Partial<Record<keyof Evidence, string>> = {};
  for (const [sourceUrl, text] of Object.entries(data.perSourceText ?? {})) {
    if (pageKeyHost(sourceUrl) !== pageKeyHost(subjectUrl)) continue;
    for (const field of ["title", "description", "story"] as const) {
      const value = text[field];
      if (byHost[field] === undefined && isNonEmptyString(value))
        byHost[field] = value;
    }
  }
  const values = {
    title: byHost.title ?? data.brandName,
    description: byHost.description ?? data.description,
    story: byHost.story ?? data.story,
  };
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => isNonEmptyString(value)),
  ) as Evidence;
}

function scrapeFailureReason(result: MultiScrapeResult): string {
  const failed = result.statuses.find(
    (status) => !status.ok && isNonEmptyString(status.error),
  );
  return failed?.error ?? "no page text captured";
}

async function fetchCohortBrands(): Promise<BrandRow[]> {
  const supabase = createServiceClient();
  const brands: BrandRow[] = [];
  for (let offset = 0; ; offset += BATCH_SIZE) {
    const { data, error } = await supabase
      .from("brands")
      .select("id, slug, name, category, purchase_website")
      .eq("status", "approved")
      .order("slug", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as BrandRow[];
    brands.push(
      ...page.filter(
        (brand) =>
          brandNameTokens(brand.name).length === 0 &&
          isNonEmptyString(brand.purchase_website),
      ),
    );
    if (page.length < BATCH_SIZE) return brands;
  }
}

async function mapConcurrent<T, U>(
  values: T[],
  worker: (value: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];
  let next = 0;
  async function run(): Promise<void> {
    while (next < values.length) {
      const index = next++;
      results[index] = await worker(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(SCRAPE_CONCURRENCY, values.length) }, run),
  );
  return results;
}

/**
 * Sends every `auditedCall` record to the eval sink instead of Supabase.
 *
 * Appends synchronously-serialised JSONL rather than batching: a scan that dies
 * mid-run must still leave behind the record of what it already fetched, and
 * the volume here (hundreds of rows) makes buffering pointless. Returning
 * `null` reports success to `emitAuditRecord`, so a diverted write is never
 * counted against the audit-loss alarm.
 */
function divertAuditWrites(sinkPath: string): void {
  setAuditWriteSeam(async (record: AuditRecord) => {
    try {
      await mkdir(dirname(sinkPath), { recursive: true });
      await appendFile(
        sinkPath,
        `${JSON.stringify({ sink: "audit", ...record })}\n`,
        "utf8",
      );
      return null;
    } catch (error) {
      // Reported, not thrown: losing a diverted audit line must not abort a
      // read-only report that is otherwise producing valid evidence.
      return { message: error instanceof Error ? error.message : String(error) };
    }
  });
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    printHelp();
    return;
  }
  const sinkPath = process.env.CURATION_EVAL_SINK?.trim();
  if (!sinkPath)
    throw new Error(
      "CURATION_EVAL_SINK must be set, or audit rows will be written to production",
    );
  divertAuditWrites(sinkPath);
  if (!process.env.OPENAI_API_KEY)
    throw new Error(
      "OPENAI_API_KEY is required — the arbiter makes real calls",
    );
  const limitText = argValue("--limit");
  const parsedLimit =
    limitText === undefined ? undefined : Number.parseInt(limitText, 10);
  if (
    limitText !== undefined &&
    (parsedLimit === undefined ||
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 0)
  )
    throw new Error("--limit must be a non-negative integer");
  const limit = parsedLimit;
  const outPath = argValue("--out") ?? DEFAULT_OUT;
  const model = {
    batch: resolveProfileModel("siteIdentityBatch"),
    single: resolveProfileModel("siteIdentity"),
  };
  const cohort = (await fetchCohortBrands()).slice(0, limit);
  const captured = await mapConcurrent(cohort, async (brand) => {
    const url = brand.purchase_website as string;
    try {
      const result = await scrapeBrandUrls([url], { brandName: brand.name });
      const evidence = evidenceFrom(result.data, url);
      return {
        brand,
        url,
        evidence,
        reason:
          Object.keys(evidence).length === 0
            ? scrapeFailureReason(result)
            : undefined,
      };
    } catch (error) {
      return {
        brand,
        url,
        evidence: {},
        reason: error instanceof Error ? error.message : "scrape failed",
      };
    }
  });
  // The one split this whole report exists to enforce: a brand whose page text
  // could not be captured is UNSCOREABLE, never a clear. It is not sent to the
  // arbiter at all, because an evidence-free item measures the prompt's release
  // default rather than the page — and a site that could not be judged is not a
  // site judged wrong. Remediation reads `decision`, so the exclusion made here
  // is the exclusion that reaches production.
  const unscoreable: Unscoreable[] = captured
    .filter((entry) => Object.keys(entry.evidence).length === 0)
    .map((entry) => ({
      slug: entry.brand.slug,
      brandName: entry.brand.name ?? "",
      url: entry.url,
      reason: entry.reason ?? "no page text captured",
    }));
  const scoreable = captured.filter(
    (entry) => Object.keys(entry.evidence).length > 0,
  );
  const items: SiteIdentityItem[] = scoreable.map(
    ({ brand, url, evidence }) => ({
      slug: brand.slug,
      brandName: brand.name ?? "",
      categorySlug: brand.category ?? undefined,
      subjectUrl: url,
      subjectKind: "website",
      pageTitle: evidence.title,
      pageDescription: evidence.description,
      pageStory: evidence.story,
      target: { type: "brand", id: brand.id },
    }),
  );
  const outcome = await arbitrateSiteIdentity(items, randomUUID());
  const rows: ScanRow[] = captured.map(({ brand, url, evidence }) => {
    if (Object.keys(evidence).length === 0)
      return {
        slug: brand.slug,
        brandName: brand.name ?? "",
        url,
        verdict: null,
        confidence: null,
        reason: null,
        evidencePresent: false,
        decision: "unscoreable",
      };
    const verdict = outcome.results.get(siteIdentityKey(brand.slug, url));
    // `resolveQuarantine` is production's confidence rule, imported rather than
    // restated so this report and the live phase can never disagree about what
    // "high-confidence not owned" means. A missing verdict is a provider
    // failure, which it resolves to `keep` — releasing is the safe direction.
    const decision = resolveQuarantine(verdict).revoked ? "clear" : "keep";
    return {
      slug: brand.slug,
      brandName: brand.name ?? "",
      url,
      verdict: verdict?.owned ?? null,
      confidence: verdict?.confidence ?? null,
      reason: verdict?.reason ?? "provider-failure",
      evidencePresent: true,
      decision,
    };
  });
  const counts = {
    clear: rows.filter((row) => row.decision === "clear").length,
    keep: rows.filter((row) => row.decision === "keep").length,
    unscoreable: unscoreable.length,
  };
  console.log(
    `\ncounts: clear=${counts.clear} keep=${counts.keep} unscoreable=${counts.unscoreable}`,
  );
  console.log("\nproposed clears");
  for (const row of rows.filter((candidate) => candidate.decision === "clear"))
    console.log(
      `  ${row.brandName} — ${row.url} — ${row.confidence} — ${row.reason}`,
    );
  console.log(
    `\nunscoreable (excluded from every tally): ${unscoreable.length}`,
  );
  for (const skipped of unscoreable)
    console.log(`  ${skipped.brandName} — ${skipped.url} — ${skipped.reason}`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify(
      { ranAt: new Date().toISOString(), model, counts, rows, unscoreable },
      null,
      2,
    ),
  );
  console.log(`\nwrote ${outPath}`);
}

void main().catch((error) => {
  console.error(
    "\nFAILED:",
    error instanceof Error
      ? (error.stack ?? error.message)
      : JSON.stringify(error),
  );
  // Still 0: a failed run is reported, not asserted. See the header.
  process.exitCode = 0;
});

export {};
