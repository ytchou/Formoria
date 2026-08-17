/**
 * Operator script: author FAQ answers for approved brands via the `faq`
 * enrichment phase (DEV-1317).
 *
 * Why this exists rather than `pnpm curate`: neither existing entry point can
 * express "run only the faq phase, fill gaps only".
 *   - `pnpm curate enrich --slugs=…` does not enrich at all — it queues
 *     `request_brand_refresh` for the FULL pipeline, so you pay every phase and
 *     get patches that need moderation.
 *   - `pnpm curate enrich` (no slugs) targets submissions, and `runFaqPhase`
 *     deliberately skips submission targets: a submission id has no `brands`
 *     row, so an upsert keyed by it would violate the FK. A submission's FAQ is
 *     authored once it is approved and this script runs against the brand.
 *   - `scripts/curation-rerun/refresh.ts` is the real three-step pipeline over a
 *     cohort — correct, but whole-pipeline per brand and far more blast radius
 *     than FAQ needs.
 *
 * This reimplements nothing: it calls `runFaqPhase`, the same function the
 * curation worker calls, one brand at a time.
 *
 * COST — read before using --overwrite. `runFaqPhase` decides fill-gaps vs
 * re-author from `explicitPhases`. By default this script passes an empty list,
 * so the phase's coverage gate short-circuits any brand whose eligible presets
 * already have complete stored entries — one cheap read, zero LLM calls.
 * `--overwrite` forces re-authoring of EVERY brand, which is a full FAQ call
 * per brand and replaces model answers that may already be fine.
 *
 * Ordering: run this AFTER the DEV-1317 migrations are applied
 * (`supabase db push --linked --include-all`). Running it before the purge
 * migration would author rows the purge then deletes.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-faq-entries.ts
 *     # DRY RUN: report coverage per brand, no LLM calls, no writes
 *   … scripts/backfill-faq-entries.ts --apply --limit=10
 *     # author the first 10 brands — start here and eyeball the answers
 *   … scripts/backfill-faq-entries.ts --apply --slugs=a,b
 *   … scripts/backfill-faq-entries.ts --apply
 *   … scripts/backfill-faq-entries.ts --apply --overwrite   # expensive, re-authors everything
 */
import { runFaqPhase } from "@/lib/services/enrich-phases/faq";
import { getBrandFaqEntries } from "@/lib/services/brand-faq";
import { mapWithConcurrency } from "@/lib/services/_shared/concurrency";
import { excludeTestBrands } from "@/lib/services/public-brand-filter";
import { createServiceClient } from "@/lib/supabase/service";

/** Matches ENRICH_BRAND_CONCURRENCY in curation-operations. */
const CONCURRENCY = 3;

const APPLY = process.argv.includes("--apply");
const OVERWRITE = process.argv.includes("--overwrite");

function flag(name: string): string[] {
  const raw =
    process.argv
      .find((arg) => arg.startsWith(`--${name}=`))
      ?.slice(name.length + 3) ?? "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

const SLUGS = flag("slugs");
const LIMIT = Number(flag("limit")[0] ?? "");

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

type Candidate = { id: string; slug: string; name: string };

async function loadCandidates(): Promise<Candidate[]> {
  const supabase = createServiceClient();
  let query = excludeTestBrands(
    supabase.from("brands").select("id, slug, name").eq("status", "approved"),
  ).order("slug", { ascending: true });

  if (SLUGS.length > 0) query = query.in("slug", SLUGS);

  const { data, error } = await query;
  if (error)
    throw new Error(`loading approved brands failed: ${error.message}`);

  const rows = (data ?? []) as Candidate[];
  if (SLUGS.length > 0) {
    const found = new Set(rows.map((row) => row.slug));
    const missing = SLUGS.filter((slug) => !found.has(slug));
    if (missing.length > 0) {
      throw new Error(`no approved brand for slug(s): ${missing.join(", ")}`);
    }
  }
  return Number.isSafeInteger(LIMIT) && LIMIT > 0 ? rows.slice(0, LIMIT) : rows;
}

/**
 * Dry run stays cheap on purpose: one existing-rows read per brand, no peer
 * stats and no model call. It answers "who lost rows to the purge and would
 * call out", not "what exactly would each preset say".
 */
async function report(candidates: Candidate[]): Promise<void> {
  let empty = 0;
  let missingPrice = 0;

  await mapWithConcurrency(candidates, CONCURRENCY, async (brand) => {
    const stored = await getBrandFaqEntries(brand.id);
    const hasPrice = stored.some(
      (entry) => entry.presetId === "price-positioning",
    );
    if (stored.length === 0) empty += 1;
    if (!hasPrice) missingPrice += 1;
    console.log(
      `  ${brand.slug}: ${stored.length} stored ${stored.length === 1 ? "entry" : "entries"}${hasPrice ? "" : " — no price-positioning row"}`,
    );
  });

  console.log(
    `\n[backfill-faq] ${empty} brand(s) have no FAQ entries at all; ${missingPrice} lack a price-positioning row.`,
  );
  console.log(
    "[backfill-faq] Re-run with --apply to author them. Without --overwrite, brands whose eligible presets are already complete are skipped with no LLM call.",
  );
}

async function author(candidates: Candidate[]): Promise<void> {
  let authored = 0;
  let skipped = 0;
  let failed = 0;

  await mapWithConcurrency(candidates, CONCURRENCY, async (brand) => {
    try {
      const { phaseResult } = await runFaqPhase({
        brand: { id: brand.id, slug: brand.slug, name: brand.name },
        phases: ["faq"],
        scrapedData: null,
        serpSnippets: [],
        target: { type: "brand", id: brand.id },
        // Empty unless --overwrite: this is what keeps a re-run cheap. See the
        // COST note in the header.
        explicitPhases: OVERWRITE ? ["faq"] : [],
      });

      if (phaseResult.status === "succeeded") authored += 1;
      else if (phaseResult.status === "skipped") skipped += 1;
      else failed += 1;

      console.log(
        `  ${brand.slug}: ${phaseResult.status}${phaseResult.detail ? ` — ${phaseResult.detail}` : ""}`,
      );
    } catch (error) {
      failed += 1;
      console.error(`  ${brand.slug}: ERROR — ${describeError(error)}`);
    }
  });

  console.log(
    `\n[backfill-faq] authored ${authored}, skipped ${skipped}, failed ${failed}.`,
  );
}

async function main(): Promise<void> {
  if (OVERWRITE && !APPLY) {
    throw new Error("--overwrite has no meaning without --apply");
  }

  const candidates = await loadCandidates();

  console.log(
    `[backfill-faq] mode: ${APPLY ? (OVERWRITE ? "APPLY (re-author every brand)" : "APPLY (fill gaps)") : "DRY RUN (pass --apply)"}`,
  );
  console.log(`[backfill-faq] approved brands in scope: ${candidates.length}`);
  if (candidates.length === 0) return;

  if (APPLY) await author(candidates);
  else await report(candidates);
}

main().catch((error) => {
  console.error(`[backfill-faq] ${describeError(error)}`);
  process.exit(1);
});
