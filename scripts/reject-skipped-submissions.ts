/**
 * Operator script: reject the pending submissions the curation pipeline already
 * judged to be non-brands.
 *
 * The detect phase skips an entry when the entity is not a consumer brand —
 * multi-brand 選物店, 文創園區 and 觀光工廠, 地方創生 teams, service businesses,
 * distributors, department stores. Those submissions then sit in the queue at
 * reviewStage 'skipped' forever: enrichment will never complete them, and each
 * one keeps a hidden brand row alive. This closes them out with the detector's
 * own verdict recorded as the reviewer note, so a reopen has the reason.
 *
 * Mirrors rejectSubmissionForAdmin (src/app/admin/actions.ts) — the single-item
 * workflow shared by rejectSubmissionAction and rejectSubmissionsAction — with
 * two deliberate differences, both forced by running outside a Next request
 * context:
 *
 *  1. No email is ever sent. The admin action mails a rejection notice for
 *     non-refresh submissions from a real submitter address; this script SKIPS
 *     any such row and reports it, so a bulk run can never surprise a real
 *     person. Those rows must go through the admin UI.
 *  2. `--apply` is required. The safe mode is the default because rejection
 *     deletes the submission's staged images from storage.
 *
 * Rejection is reversible via reopenSubmission (the admin UI's Reopen button);
 * the staged images are not, which is why this refuses to guess at scope.
 *
 * Usage:
 *   pnpm reject-skipped                            # dry run, whole bucket
 *   pnpm reject-skipped --apply                    # reject whole bucket
 *   pnpm reject-skipped --apply --intent=refresh   # only refreshes of existing brands
 *   pnpm reject-skipped --apply --only=<id>,<id>   # reject specific rows
 */
import {
  getSubmission,
  rejectSubmission,
  isGeneratedGuestSubmissionEmail,
} from "@/lib/services/submissions";
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
/** Narrows the bucket by submission intent — refreshes touch an existing brand row, new
 *  submissions do not, so the two are usually reviewed as separate batches. */
const INTENT =
  process.argv
    .find((arg) => arg.startsWith("--intent="))
    ?.slice("--intent=".length)
    .trim() ?? "";

/** The detect phase's verdict prefix; anything else skipped is a different problem. */
const NOT_A_BRAND_PREFIX = "Detection classified this entry as not a brand";

/** Same resolution as approve-ready-submissions.ts: first entry of ADMIN_EMAILS. */
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

type Candidate = {
  id: string;
  brandName: string;
  intent: string;
  verdict: string;
};

/**
 * Pending submissions whose most recent curation target was skipped by detection.
 * Only the newest target per submission counts — an older skip that a later run
 * superseded is not a verdict on the current state.
 */
async function loadCandidates(): Promise<Candidate[]> {
  const supabase = createServiceClient();

  const { data: pending, error } = await supabase
    .from("brand_submissions")
    .select("id, brand_name, intent")
    .eq("status", "pending");
  if (error) throw error;
  const rows = pending ?? [];
  if (rows.length === 0) return [];

  const latestBySubmission = new Map<
    string,
    { status: string; error: string | null }
  >();
  const ids = rows.map((row) => row.id as string);
  for (let index = 0; index < ids.length; index += 200) {
    const chunk = ids.slice(index, index + 200);
    const { data: targets, error: targetError } = await supabase
      .from("curation_job_targets")
      .select("target_id, status, error, created_at, id")
      .eq("target_type", "submission")
      .in("target_id", chunk)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (targetError) throw targetError;
    for (const target of targets ?? []) {
      const key = target.target_id as string;
      if (latestBySubmission.has(key)) continue;
      latestBySubmission.set(key, {
        status: String(target.status),
        error: (target.error as string | null) ?? null,
      });
    }
  }

  return rows.flatMap((row) => {
    const latest = latestBySubmission.get(row.id as string);
    if (latest?.status !== "skipped") return [];
    if (!latest.error?.startsWith(NOT_A_BRAND_PREFIX)) return [];
    return [
      {
        id: row.id as string,
        brandName: row.brand_name as string,
        intent: String(row.intent),
        verdict: latest.error,
      },
    ];
  });
}

async function main(): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAILS?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  if (!adminEmail)
    throw new Error("ADMIN_EMAILS must contain an admin account");

  const all = await loadCandidates();
  const selected = all.filter(
    (row) => ONLY.length === 0 || ONLY.includes(row.id),
  );

  // A silently-shrunk --only batch means an id was already reviewed or its latest
  // curation run replaced the skip. Checked before --intent narrows the set, so
  // combining the two flags reports genuinely missing ids rather than filtered ones.
  if (ONLY.length > 0 && selected.length !== ONLY.length) {
    const matched = new Set(selected.map((row) => row.id));
    throw new Error(
      `--only matched ${selected.length} of ${ONLY.length} ids; unmatched: ${ONLY.filter(
        (id) => !matched.has(id),
      ).join(", ")}`,
    );
  }

  const bucket = selected.filter(
    (row) => INTENT === "" || row.intent === INTENT,
  );

  console.log(
    `[reject-skipped] mode: ${APPLY ? "APPLY" : "DRY RUN (pass --apply)"}`,
  );
  console.log(
    `[reject-skipped] detection-skipped, still pending: ${bucket.length}` +
      (INTENT
        ? ` (intent=${INTENT}, ${all.length - bucket.length} other rows left alone)`
        : ""),
  );
  if (bucket.length === 0) return;

  const reviewerId = APPLY ? await resolveReviewerId(adminEmail) : "";
  let rejected = 0;
  let skipped = 0;
  let failed = 0;

  for (const [index, row] of bucket.entries()) {
    const label = `[${index + 1}/${bucket.length}] ${row.brandName}`;
    const reason = row.verdict
      .slice(NOT_A_BRAND_PREFIX.length)
      .replace(/^:\s*/, "");

    try {
      const submission = await getSubmission(row.id);
      const wouldEmail =
        submission.intent !== "refresh" &&
        !isGeneratedGuestSubmissionEmail(submission.submitterEmail);
      if (wouldEmail) {
        skipped += 1;
        console.log(
          `${label} — SKIP (real submitter would be emailed; use /admin/submissions)`,
        );
        continue;
      }
      if (!APPLY) {
        console.log(`${label} — would reject (${row.intent}): ${reason}`);
        continue;
      }
      await rejectSubmission(row.id, reviewerId, "other", row.verdict);
      rejected += 1;
      console.log(`${label} — rejected: ${reason}`);
    } catch (err) {
      failed += 1;
      console.error(
        `${label} — FAILED: ${err instanceof Error ? err.message : JSON.stringify(err)}`,
      );
    }
  }

  console.log(
    `\n[reject-skipped] rejected: ${rejected}  skipped: ${skipped}  failed: ${failed}`,
  );
  if (rejected > 0) {
    console.log(
      "[reject-skipped] brand rows stay hidden; delete them separately if unwanted.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
