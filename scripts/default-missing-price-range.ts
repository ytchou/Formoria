/**
 * Operator script: fill `price_range` with the mid-range default on pending
 * submissions that enrichment left without one.
 *
 * The curation worker now falls back to `DEFAULT_PRICE_RANGE` whenever the
 * description model reports no usable price signal (see
 * `resolveEnrichedPriceRange`). Rows enriched BEFORE that change are still
 * sitting in the review queue with `price_range: null`, which fails the
 * completeness gate and makes them unpublishable. Re-running curation on them
 * would spend SERP + model budget to recover a single field, so this writes the
 * same value the worker would produce today.
 *
 * Scope is deliberately narrow: only rows whose ONLY missing field is
 * `priceRange`. A row that is also missing a hero image or a description needs
 * real enrichment, not a default, and a bulk price write would just hide how
 * little the pipeline recovered for it.
 *
 * Writes go through persistSubmissionEnrichmentResults, the same path the
 * worker uses — so refresh submissions keep their owner/admin field-state
 * protection, and non-pending rows are skipped rather than overwritten.
 *
 * `--include-partial` widens the bucket to every row missing a price range,
 * including ones still missing other fields. Use it when the price default is
 * being applied as bookkeeping — so a row's remaining blocker reads honestly —
 * rather than to make a row publishable on its own.
 *
 * Usage:
 *   pnpm default-price-range                            # dry run, whole bucket
 *   pnpm default-price-range --apply                    # fill whole bucket
 *   pnpm default-price-range --apply --only=<id>        # fill specific rows
 *   pnpm default-price-range --apply --include-partial  # also rows missing other fields
 */
import { getSubmissionsForReview } from "@/lib/services/submissions";
import { persistSubmissionEnrichmentResults } from "@/lib/services/curation-operations";
import { createServiceClient } from "@/lib/supabase/service";
import { DEFAULT_PRICE_RANGE } from "@/lib/brands/price-range";

const APPLY = process.argv.includes("--apply");
const INCLUDE_PARTIAL = process.argv.includes("--include-partial");
const ONLY = (
  process.argv
    .find((arg) => arg.startsWith("--only="))
    ?.slice("--only=".length) ?? ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : JSON.stringify(error);
}

async function main(): Promise<void> {
  const all = await getSubmissionsForReview();
  const bucket = all.filter(
    (submission) =>
      submission.status !== "approved" &&
      submission.status !== "rejected" &&
      (INCLUDE_PARTIAL
        ? submission.reviewCompleteness.missingFields.includes("priceRange")
        : submission.reviewCompleteness.missingFields.length === 1 &&
          submission.reviewCompleteness.missingFields[0] === "priceRange") &&
      (ONLY.length === 0 || ONLY.includes(submission.id)),
  );

  console.log(
    `[default-price-range] mode: ${APPLY ? "APPLY" : "DRY RUN (pass --apply)"}`,
  );
  console.log(
    `[default-price-range] ${INCLUDE_PARTIAL ? "missing priceRange (any combination)" : "missing only priceRange"}: ${bucket.length} (will write ${DEFAULT_PRICE_RANGE})`,
  );

  // A silently-shrunk --only batch means an id already has a price range or has
  // fallen out of the bucket. Refuse rather than half-apply.
  if (ONLY.length > 0 && bucket.length !== ONLY.length) {
    const matched = new Set(bucket.map((submission) => submission.id));
    throw new Error(
      `--only matched ${bucket.length} of ${ONLY.length} ids; unmatched: ${ONLY.filter(
        (id) => !matched.has(id),
      ).join(", ")}`,
    );
  }

  const supabase = createServiceClient();
  const filled: string[] = [];
  const failures: string[] = [];

  for (const [index, row] of bucket.entries()) {
    const label = `[${index + 1}/${bucket.length}] ${row.brandName}`;
    if (!APPLY) {
      console.log(`${label} — would set price_range=${DEFAULT_PRICE_RANGE}`);
      continue;
    }
    try {
      await persistSubmissionEnrichmentResults(supabase, row.id, {
        price_range: DEFAULT_PRICE_RANGE,
      });
      filled.push(row.brandName);
      console.log(`${label} — price_range=${DEFAULT_PRICE_RANGE}`);
    } catch (error) {
      failures.push(`${row.brandName} (${row.id}) — ${describeError(error)}`);
      console.error(`${label} — FAILED: ${describeError(error)}`);
    }
  }

  console.log(
    `\n[default-price-range] filled: ${filled.length}  failed: ${failures.length}`,
  );
  for (const entry of failures) console.log(`  fail: ${entry}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
