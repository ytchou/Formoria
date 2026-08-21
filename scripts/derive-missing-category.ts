/**
 * Operator script: fill `category` on pending submissions that have
 * subcategories but no category, by voting on the subcategories' ontology categories.
 *
 * `category` is written only by the detect phase, while `subcategories` come
 * later from the descriptions phase (DEV-1273). A row whose detect run produced
 * no category therefore sits in the queue fully tagged but uncategorized, and
 * fails the review completeness gate. The curation worker already derives a
 * category from tags for new runs; this applies the same derivation to rows
 * enriched before that logic existed, without re-spending SERP or model budget.
 *
 * Uses `deriveCategoryFromSubcategories`, which returns null on a tie or an
 * unrecognized tag set — those rows are reported and left alone rather than
 * guessed at. Writes go through persistSubmissionEnrichmentResults, the same
 * path the worker uses, so refresh submissions keep their field-state
 * protection and non-pending rows are skipped.
 *
 * Usage:
 *   pnpm derive-category                        # dry run, whole bucket
 *   pnpm derive-category --apply                # fill whole bucket
 *   pnpm derive-category --apply --only=<id>    # fill specific rows
 */
import { getSubmissionsForReview } from "@/lib/services/submissions";
import { persistSubmissionEnrichmentResults } from "@/lib/services/curation-operations";
import { deriveCategoryFromSubcategories } from "@/lib/services/subcategories";
import { createServiceClient } from "@/lib/supabase/service";

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
      submission.reviewCompleteness.missingFields.includes("categorySlug") &&
      (ONLY.length === 0 || ONLY.includes(submission.id)),
  );

  console.log(
    `[derive-category] mode: ${APPLY ? "APPLY" : "DRY RUN (pass --apply)"}`,
  );
  console.log(`[derive-category] missing categorySlug: ${bucket.length}`);

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
    const subcategories = row.reviewData.subcategories;
    const categorySlug = deriveCategoryFromSubcategories(subcategories);

    if (!categorySlug) {
      undecided.push(
        `${row.brandName} — subcategories=[${subcategories.join(", ")}]${subcategories.length === 0 ? " (no subcategories; needs enrichment)" : " (tie or unrecognized)"}`,
      );
      console.log(
        `${label} — NO DERIVATION from [${subcategories.join(", ")}] — left alone`,
      );
      continue;
    }

    if (!APPLY) {
      console.log(
        `${label} — would set category=${categorySlug} from [${subcategories.join(", ")}]`,
      );
      continue;
    }

    try {
      await persistSubmissionEnrichmentResults(supabase, row.id, {
        category: categorySlug,
      });
      derived.push(`${row.brandName} -> ${categorySlug}`);
      console.log(`${label} — category=${categorySlug}`);
    } catch (error) {
      failures.push(`${row.brandName} (${row.id}) — ${describeError(error)}`);
      console.error(`${label} — FAILED: ${describeError(error)}`);
    }
  }

  console.log(
    `\n[derive-category] derived: ${derived.length}  undecided: ${undecided.length}  failed: ${failures.length}`,
  );
  for (const entry of undecided) console.log(`  undecided: ${entry}`);
  for (const entry of failures) console.log(`  fail: ${entry}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
