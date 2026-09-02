/**
 * @formoria-script
 * purpose: Approves every submission the review queue calls publishable, without the admin UI.
 * class: operator
 * invoke: pnpm approve-ready
 * target: staging-default
 * safety: writes-on-apply
 * owner: engineering
 */
/**
 * Operator script: approve every submission the review queue considers publishable —
 * `reviewStage === 'ready'` with an empty `reviewCompleteness.missingFields` —
 * without clicking through /admin/submissions.
 *
 * Mirrors approveSubmissionForAdmin (src/app/admin/actions.ts) step for step,
 * with three deliberate differences, all forced by running outside a Next
 * request context:
 *
 *  1. `revalidatePath` is replaced by requestPublicBrandRevalidation, the
 *     Next-free ISR trigger built for exactly this case (DEV-1262). It needs
 *     FORMORIA_RAILWAY_URL (or NEXT_PUBLIC_SITE_URL) plus ORIGIN_SECRET; without
 *     them the writes land but public pages serve stale HTML until the ISR
 *     window expires.
 *  2. No email is ever sent. The admin action mails a claim invite (owner
 *     submissions) or an approval notice (real submitter address); this script
 *     SKIPS any row that would trigger either and reports it, so a bulk run can
 *     never surprise a real person. Those rows must go through the admin UI.
 *  3. `--apply` is required — the dry run is the default. This path publishes
 *     brands to the live directory, so the safe mode has to be what an
 *     operator gets by typing nothing.
 *
 * Usage:
 *   pnpm approve-ready                                  # dry run, whole bucket
 *   pnpm approve-ready --apply                          # approve whole bucket
 *   pnpm approve-ready --apply --only=<id>,<id>         # approve specific rows
 */
import {
  getSubmissionsForReview,
  getSubmission,
  approveSubmission,
  applyBrandRefresh,
  isGeneratedGuestSubmissionEmail,
} from "@/lib/services/submissions";
import { createServiceClient } from "@/lib/supabase/service";
import {
  getBrandById,
  syncBrandImages,
  updateBrand,
} from "@/lib/services/brands";
import { markFlagsReviewed } from "@/lib/services/moderation";
import { requestPublicBrandRevalidation } from "@/lib/cache/revalidate-client";
import { loadScriptTarget } from "./shared/target";

const APPLY = process.argv.includes("--apply");
const ONLY = (
  process.argv
    .find((arg) => arg.startsWith("--only="))
    ?.slice("--only=".length) ?? ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

/** The reviewer of record: the first entry of ADMIN_EMAILS. */
async function resolveReviewerId(email: string): Promise<string> {
  const supabase = createServiceClient();
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1_000,
    });
    if (error) throw error;
    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email.toLowerCase(),
    );
    if (match) return match.id;
    if (data.users.length < 1_000) break;
  }
  throw new Error(`Admin user not found: ${email}`);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.cause
      ? `${error.message} | cause=${JSON.stringify(error.cause)}`
      : error.message;
  }
  return JSON.stringify(error);
}

async function main(): Promise<void> {
  loadScriptTarget();
  const adminEmail = process.env.ADMIN_EMAILS?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  if (!adminEmail)
    throw new Error("ADMIN_EMAILS must contain an admin account");

  const all = await getSubmissionsForReview();
  const bucket = all.filter(
    (submission) =>
      submission.status !== "approved" &&
      submission.status !== "rejected" &&
      submission.reviewStage === "ready" &&
      submission.reviewCompleteness.complete &&
      (ONLY.length === 0 || ONLY.includes(submission.id)),
  );

  console.log(
    `[approve-ready] mode: ${APPLY ? "APPLY" : "DRY RUN (pass --apply)"}`,
  );
  console.log(`[approve-ready] ready + complete: ${bucket.length}`);

  // A silently-shrunk --only batch means an id was already approved, rejected, or
  // has fallen out of the publishable bucket. Refuse rather than half-apply.
  if (ONLY.length > 0 && bucket.length !== ONLY.length) {
    const matched = new Set(bucket.map((submission) => submission.id));
    throw new Error(
      `--only matched ${bucket.length} of ${ONLY.length} ids; unmatched: ${ONLY.filter(
        (id) => !matched.has(id),
      ).join(", ")}`,
    );
  }

  // Resolved once, and only when it will actually be used: a dry run must not
  // need admin-API credentials just to print what it would do.
  const reviewerId =
    APPLY && bucket.length > 0 ? await resolveReviewerId(adminEmail) : "";

  const approvedSlugs: string[] = [];
  const skipped: string[] = [];
  const failures: string[] = [];

  for (const [index, row] of bucket.entries()) {
    const label = `[${index + 1}/${bucket.length}] ${row.brandName}`;
    try {
      const submission = await getSubmission(row.id);

      if (submission.intent === "refresh") {
        if (!APPLY) {
          console.log(`${label} — would apply refresh`);
          continue;
        }
        const refresh = await applyBrandRefresh(row.id, reviewerId);
        const brand = await getBrandById(refresh.brandId);
        // Mirrors approveSubmissionForAdmin: approving a refresh publishes the
        // brand, so a hidden one comes live.
        const unhidden = brand.status === "hidden";
        if (unhidden)
          await updateBrand(refresh.brandId, { status: "approved" });
        approvedSlugs.push(brand.slug);
        console.log(
          `${label} — refreshed -> /brands/${brand.slug}${unhidden ? " (unhidden)" : ""}${
            refresh.cleanupFailed ? " (storage cleanup warning)" : ""
          }`,
        );
        continue;
      }

      // The admin action would email here; this script cannot, so it declines.
      if (submission.isBrandOwner) {
        skipped.push(
          `${row.brandName} — owner submission needs a claim invite email`,
        );
        console.log(
          `${label} — SKIPPED (needs claim invite; use the admin UI)`,
        );
        continue;
      }
      if (!isGeneratedGuestSubmissionEmail(submission.submitterEmail)) {
        skipped.push(
          `${row.brandName} — would email ${submission.submitterEmail}`,
        );
        console.log(
          `${label} — SKIPPED (would email a real submitter; use the admin UI)`,
        );
        continue;
      }

      if (!APPLY) {
        console.log(`${label} — would approve (new brand, no email)`);
        continue;
      }

      const { brandId } = await approveSubmission(row.id, reviewerId);
      const brand = await getBrandById(brandId);
      approvedSlugs.push(brand.slug);

      try {
        await markFlagsReviewed(brandId);
      } catch (error) {
        console.warn(
          `${label} — markFlagsReviewed failed: ${describeError(error)}`,
        );
      }

      let imageNote = "";
      if (brand.heroImageUrl) {
        try {
          const sync = await syncBrandImages(brandId);
          if (sync.failed > 0)
            imageNote = ` (image sync failed: ${sync.failed})`;
        } catch (error) {
          console.warn(
            `${label} — syncBrandImages failed: ${describeError(error)}`,
          );
          imageNote = " (image sync threw)";
        }
      }

      console.log(`${label} — approved -> /brands/${brand.slug}${imageNote}`);
    } catch (error) {
      failures.push(`${row.brandName} (${row.id}) — ${describeError(error)}`);
      console.error(`${label} — FAILED: ${describeError(error)}`);
    }
  }

  console.log(
    `\n[approve-ready] approved: ${approvedSlugs.length}  skipped: ${skipped.length}  failed: ${failures.length}`,
  );
  for (const entry of skipped) console.log(`  skip: ${entry}`);
  for (const entry of failures) console.log(`  fail: ${entry}`);

  if (APPLY && approvedSlugs.length > 0) {
    const result = await requestPublicBrandRevalidation(approvedSlugs);
    console.log(
      `[approve-ready] ISR revalidation: ${result.ok ? "ok" : `FAILED (${result.reason})`}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
