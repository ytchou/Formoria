/**
 * Operator script: fill `product_type` on pending submissions that have product
 * tags but no category, by voting on the tags' ontology categories.
 *
 * `product_type` is written only by the detect phase, while `product_tags` come
 * later from the descriptions phase (DEV-1273). A row whose detect run produced
 * no category therefore sits in the queue fully tagged but uncategorized, and
 * fails the review completeness gate. The curation worker already derives a
 * category from tags for new runs; this applies the same derivation to rows
 * enriched before that logic existed, without re-spending SERP or model budget.
 *
 * Uses `deriveProductTypeFromTags`, which returns null on a tie or an
 * unrecognized tag set — those rows are reported and left alone rather than
 * guessed at. Writes go through persistSubmissionEnrichmentResults, the same
 * path the worker uses, so refresh submissions keep their field-state
 * protection and non-pending rows are skipped.
 *
 * Usage:
 *   pnpm derive-product-type                        # dry run, whole bucket
 *   pnpm derive-product-type --apply                # fill whole bucket
 *   pnpm derive-product-type --apply --only=<id>    # fill specific rows
 */
import { getSubmissionsForReview } from "@/lib/services/submissions";
import { persistSubmissionEnrichmentResults } from "@/lib/services/curation-operations";
import { deriveProductTypeFromTags } from "@/lib/services/product-tags";
import { createServiceClient } from "@/lib/supabase/server";

const APPLY = process.argv.includes("--apply");
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
      submission.reviewCompleteness.missingFields.includes("productType") &&
      (ONLY.length === 0 || ONLY.includes(submission.id)),
  );

  console.log(
    `[derive-product-type] mode: ${APPLY ? "APPLY" : "DRY RUN (pass --apply)"}`,
  );
  console.log(`[derive-product-type] missing productType: ${bucket.length}`);

  // A silently-shrunk --only batch means an id already has a category or has
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
  const derived: string[] = [];
  const undecided: string[] = [];
  const failures: string[] = [];

  for (const [index, row] of bucket.entries()) {
    const label = `[${index + 1}/${bucket.length}] ${row.brandName}`;
    const tags = row.reviewData.productTags;
    const productType = deriveProductTypeFromTags(tags);

    if (!productType) {
      undecided.push(
        `${row.brandName} — tags=[${tags.join(", ")}]${tags.length === 0 ? " (no tags; needs enrichment)" : " (tie or unrecognized)"}`,
      );
      console.log(
        `${label} — NO DERIVATION from [${tags.join(", ")}] — left alone`,
      );
      continue;
    }

    if (!APPLY) {
      console.log(
        `${label} — would set product_type=${productType} from [${tags.join(", ")}]`,
      );
      continue;
    }

    try {
      await persistSubmissionEnrichmentResults(supabase, row.id, {
        product_type: productType,
      });
      derived.push(`${row.brandName} -> ${productType}`);
      console.log(`${label} — product_type=${productType}`);
    } catch (error) {
      failures.push(`${row.brandName} (${row.id}) — ${describeError(error)}`);
      console.error(`${label} — FAILED: ${describeError(error)}`);
    }
  }

  console.log(
    `\n[derive-product-type] derived: ${derived.length}  undecided: ${undecided.length}  failed: ${failures.length}`,
  );
  for (const entry of undecided) console.log(`  undecided: ${entry}`);
  for (const entry of failures) console.log(`  fail: ${entry}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
