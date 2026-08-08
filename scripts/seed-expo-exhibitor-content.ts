/**
 * Operator script: give the uncurated 2026 Creative Expo exhibitors a real
 * thumbnail and one-line summary (DEV-1396).
 *
 * 125 of the event's 307 exhibitors have no Formoria brand, so the roster page
 * renders half a floor guide — a monogram, a booth, an area label — where a
 * listed brand shows an image and a blurb. 109 of those have an official
 * website and can be enriched.
 *
 * THE ROSTER OWNS THE CONTENT (decided in DEV-1395). `brand_submissions` is
 * only an offline enrichment vehicle here: this script copies the enrichment
 * output onto `event_exhibitors` columns and copies the storage object to a
 * roster-owned `event-exhibitors/` key, so no submission lifecycle event —
 * rejection, a bulk needs-data drop, the seven-day retention reaper — can blank
 * what a visitor sees. `content_submission_id` is provenance and a re-run
 * idempotency key ONLY; the render path never reads through it.
 *
 * Four phases, each behind its own flag, so a failure is resumable and spend is
 * gated. They are meant to be run one at a time, in order:
 *
 *   1. --submissions  mint one pending submission per exhibitor (no AI spend)
 *   2. --enrich       run the real curation pipeline over them (AI spend)
 *   3. --harvest      COPY image + summaries onto the roster row  <- the point
 *   4. --retire       reject the now-redundant submissions (destructive)
 *
 * Like scripts/rerun-submission-curation.ts, this contains no pipeline logic of
 * its own — it calls the same exported functions the product already uses.
 *
 * Usage:
 *   pnpm seed-expo-content --submissions --dry-run
 *   pnpm seed-expo-content --submissions
 *   pnpm seed-expo-content --enrich --limit=10     # cautious first batch
 *   pnpm seed-expo-content --enrich
 *   pnpm seed-expo-content --harvest
 *   pnpm seed-expo-content --retire                # dry run
 *   pnpm seed-expo-content --retire --yes          # actually reject
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  claimCurationJob,
  enqueueAdminCurationJob,
} from "@/lib/services/curation-jobs";
import { runJob } from "@/lib/services/job-runner";
import { createSubmission, rejectSubmission } from "@/lib/services/submissions";
import { uploadWithRetry } from "@/lib/services/storage-retry";
import { createServiceClient } from "@/lib/supabase/service";
import { enrichedDataFromDb } from "@/lib/types/enriched-data";

const EVENT_SLUG = "2026-taiwan-creative-expo";
const LEDGER_PATH = "content/events/2026-taiwan-creative-expo.exhibitors.json";
/** Must stay @formoria.com: the Cloudflare catch-all routes it to Drop, so a
 *  stray notification can never reach a real inbox. */
const SUBMITTER_EMAIL = "roster-enrichment@formoria.com";
const BUCKET = "brand-images";
const IN_CHUNK_SIZE = 100;
const LOG = "[expo-roster]";
const RETIRE_REASON =
  "Retired after the 2026 Creative Expo roster enrichment pass (DEV-1396): " +
  "the image and summaries were copied onto the event_exhibitors row, so this " +
  "submission is no longer needed in the moderation queue.";
/** The provenance sentence the ticket asked for. It cannot go in
 *  `source_attribution` — that column is a five-value check constraint
 *  (00011_community_first_pivot.sql) mirrored by the SourceAttribution union —
 *  so the enum takes its closest member and the free text goes here. */
const SOURCE_NOTE = "2026 Taiwan Creative Expo official exhibitor list";
const PRIORITY_ORDER = ["high", "medium", "low"] as const;

const DRY_RUN = process.argv.includes("--dry-run");
const YES = process.argv.includes("--yes");
const PHASES = {
  adopt: process.argv.includes("--adopt"),
  submissions: process.argv.includes("--submissions"),
  enrich: process.argv.includes("--enrich"),
  harvest: process.argv.includes("--harvest"),
  retire: process.argv.includes("--retire"),
};
const LIMIT = (() => {
  const raw = process.argv
    .find((arg) => arg.startsWith("--limit="))
    ?.slice("--limit=".length);
  if (!raw) return Number.POSITIVE_INFINITY;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--limit must be a positive integer, got "${raw}"`);
  }
  return parsed;
})();

type LedgerExhibitor = {
  sourceKey: string;
  name: string;
  nameEn: string | null;
  websiteUrl: string | null;
  outcome: string;
  reviewPriority: string;
};

type ExhibitorRow = {
  id: string;
  source_key: string;
  content_submission_id: string | null;
  image_url: string | null;
};

type Candidate = {
  ledger: LedgerExhibitor;
  row: ExhibitorRow;
};

function applyLimit<T>(values: T[]): T[] {
  return LIMIT === Number.POSITIVE_INFINITY ? values : values.slice(0, LIMIT);
}

function chunked<T>(values: T[], size = IN_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : JSON.stringify(err);
}

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

/**
 * The 109 ledger records that are on the floor plan but not in the directory:
 * `outcome === "included_unlinked"` with an official website to enrich from.
 */
async function loadLedgerCandidates(): Promise<LedgerExhibitor[]> {
  const raw = await readFile(path.join(process.cwd(), LEDGER_PATH), "utf8");
  const parsed = JSON.parse(raw) as { exhibitors?: LedgerExhibitor[] };
  const exhibitors = parsed.exhibitors ?? [];
  if (exhibitors.length === 0) {
    throw new Error(`${LEDGER_PATH}: no exhibitors found`);
  }
  return exhibitors.filter(
    (exhibitor) =>
      exhibitor.outcome === "included_unlinked" &&
      typeof exhibitor.websiteUrl === "string" &&
      exhibitor.websiteUrl.trim().length > 0,
  );
}

async function resolveEventId(): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("events")
    .select("id")
    .eq("slug", EVENT_SLUG)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Event not found: ${EVENT_SLUG}`);
  return data.id;
}

/**
 * Joins the ledger to the DB by `(event_id, source_key)`. A ledger record with
 * no roster row means the roster seed has not been re-run; that is reported
 * rather than silently dropped, because it would otherwise look like a
 * shrinking candidate set for no visible reason.
 */
async function loadCandidates(
  eventId: string,
  ledger: LedgerExhibitor[],
): Promise<Candidate[]> {
  const supabase = createServiceClient();
  const rowsByKey = new Map<string, ExhibitorRow>();
  for (const chunk of chunked(ledger.map((entry) => entry.sourceKey))) {
    const { data, error } = await supabase
      .from("event_exhibitors")
      .select("id, source_key, content_submission_id, image_url")
      .eq("event_id", eventId)
      .in("source_key", chunk);
    if (error) throw error;
    for (const row of data ?? []) rowsByKey.set(row.source_key, row);
  }

  const missing = ledger.filter((entry) => !rowsByKey.has(entry.sourceKey));
  if (missing.length > 0) {
    console.warn(
      `${LOG} WARNING: ${missing.length} ledger record(s) have no roster row (re-run pnpm seed-events): ${missing
        .map((entry) => entry.sourceKey)
        .join(", ")}`,
    );
  }

  return ledger.flatMap((entry) => {
    const row = rowsByKey.get(entry.sourceKey);
    return row ? [{ ledger: entry, row }] : [];
  });
}

/** Submission ids that are still `pending`, keyed for cheap membership tests. */
async function loadPendingSubmissionIds(ids: string[]): Promise<Set<string>> {
  const supabase = createServiceClient();
  const pending = new Set<string>();
  for (const chunk of chunked(ids)) {
    const { data, error } = await supabase
      .from("brand_submissions")
      .select("id")
      .eq("status", "pending")
      .in("id", chunk);
    if (error) throw error;
    for (const row of data ?? []) pending.add(row.id);
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Phase 0 — adopt submissions that already exist
// ---------------------------------------------------------------------------

/**
 * Links exhibitors to pending submissions that were created outside this script
 * — the 2026 expo cohort was enriched from the admin UI before the roster
 * columns existed, so ~62 submissions were already on disk with nothing
 * pointing at them.
 *
 * This has to run before `--submissions`, which decides what to create purely
 * from `content_submission_id is null` and would otherwise mint a duplicate for
 * every one of them. Adopt first, and `--submissions` correctly narrows to the
 * exhibitors that genuinely have no submission.
 *
 * Matching is on `website_url`, the only field both sides are guaranteed to
 * share: the roster carries the official listing's name and the submission
 * carries whatever the submitter typed. Ambiguity in either direction is
 * skipped rather than guessed — a wrong link would put another brand's photo on
 * an exhibitor, which is worse than leaving the monogram.
 *
 * Only `pending` submissions are adopted. An approved one has already had its
 * `submission_images` deleted by `approve_submission` (they were copied to
 * `brand_images`), so there is nothing to harvest; those exhibitors belong in
 * the ledger as `matched_existing` instead.
 */
async function runAdoptPhase(candidates: Candidate[]): Promise<void> {
  const supabase = createServiceClient();

  const unlinked = candidates.filter(
    (candidate) => !candidate.row.content_submission_id,
  );
  const byUrl = new Map<string, Candidate[]>();
  for (const candidate of unlinked) {
    const url = candidate.ledger.websiteUrl?.trim();
    if (!url) continue;
    byUrl.set(url, [...(byUrl.get(url) ?? []), candidate]);
  }

  console.log(
    `${LOG} adopt: ${unlinked.length} exhibitor(s) without a submission, ${byUrl.size} distinct website(s)`,
  );
  if (byUrl.size === 0) return;

  // Pending submissions keyed by URL. A URL claimed by more than one pending
  // submission is ambiguous on this side and gets skipped below.
  const submissionsByUrl = new Map<string, { id: string }[]>();
  for (const chunk of chunked([...byUrl.keys()])) {
    const { data, error } = await supabase
      .from("brand_submissions")
      .select("id, website_url")
      .eq("status", "pending")
      .in("website_url", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      if (!row.website_url) continue;
      submissionsByUrl.set(row.website_url, [
        ...(submissionsByUrl.get(row.website_url) ?? []),
        { id: row.id },
      ]);
    }
  }

  // A submission already adopted by some other exhibitor must not be stolen:
  // the partial unique index would reject it, and the first owner would lose
  // nothing while this one gained a duplicate-looking error.
  const claimed = new Set(
    candidates
      .map((candidate) => candidate.row.content_submission_id)
      .filter((id): id is string => id !== null),
  );

  type Adoption = { candidate: Candidate; submissionId: string };
  const adoptions: Adoption[] = [];
  let ambiguousExhibitors = 0;
  let ambiguousSubmissions = 0;
  let noMatch = 0;

  for (const [url, group] of byUrl) {
    const matches = (submissionsByUrl.get(url) ?? []).filter(
      (row) => !claimed.has(row.id),
    );
    if (matches.length === 0) {
      noMatch += 1;
      continue;
    }
    if (group.length > 1) {
      ambiguousExhibitors += 1;
      console.warn(
        `${LOG} adopt: SKIP ${url} — ${group.length} exhibitors share this website`,
      );
      continue;
    }
    if (matches.length > 1) {
      ambiguousSubmissions += 1;
      console.warn(
        `${LOG} adopt: SKIP ${url} — ${matches.length} pending submissions share this website`,
      );
      continue;
    }
    const only = group[0];
    const match = matches[0];
    if (!only || !match) continue;
    adoptions.push({ candidate: only, submissionId: match.id });
  }

  console.log(
    `${LOG} adopt: ${adoptions.length} adoptable, ${noMatch} without a pending submission, ${ambiguousExhibitors + ambiguousSubmissions} ambiguous`,
  );

  const actionable = applyLimit(adoptions);
  if (DRY_RUN) {
    for (const adoption of actionable) {
      console.log(
        `${LOG}   would adopt: ${adoption.candidate.ledger.name} ← ${adoption.submissionId}`,
      );
    }
    console.log(`${LOG} dry run — nothing linked`);
    return;
  }

  let linked = 0;
  let failed = 0;
  for (const adoption of actionable) {
    const { error } = await supabase
      .from("event_exhibitors")
      .update({ content_submission_id: adoption.submissionId })
      .eq("id", adoption.candidate.row.id);
    if (error) {
      failed += 1;
      console.error(
        `${LOG} ${adoption.candidate.ledger.name} — FAILED: ${describe(error)}`,
      );
      continue;
    }
    adoption.candidate.row.content_submission_id = adoption.submissionId;
    linked += 1;
  }

  console.log(`${LOG} adopt complete — linked ${linked}, failed ${failed}`);
}

// ---------------------------------------------------------------------------
// Phase 1 — mint one pending submission per exhibitor
// ---------------------------------------------------------------------------

async function runSubmissionsPhase(candidates: Candidate[]): Promise<void> {
  const supabase = createServiceClient();

  // THE IDEMPOTENCY GUARD. createSubmission has NO uniqueness constraint of its
  // own, so a re-run without this check would mint 109 duplicate submissions;
  // the partial unique index on content_submission_id is only the backstop.
  const actionable = applyLimit(
    candidates.filter((candidate) => !candidate.row.content_submission_id),
  );
  const alreadyLinked = candidates.length - actionable.length;

  console.log(
    `${LOG} submissions: ${candidates.length} candidate(s), ${actionable.length} to create, ${alreadyLinked} already linked`,
  );
  if (DRY_RUN) {
    for (const candidate of actionable) {
      console.log(
        `${LOG}   would create: ${candidate.ledger.name} (${candidate.ledger.websiteUrl})`,
      );
    }
    console.log(`${LOG} dry run — nothing created`);
    return;
  }

  let created = 0;
  let failed = 0;
  for (const [index, candidate] of actionable.entries()) {
    const label = `${LOG} [${index + 1}/${actionable.length}] ${candidate.ledger.name}`;
    let submissionId: string | null = null;
    try {
      const submission = await createSubmission({
        brandName: candidate.ledger.name,
        submitterEmail: SUBMITTER_EMAIL,
        websiteUrl: candidate.ledger.websiteUrl,
        description: SOURCE_NOTE,
        sourceAttribution: "found_online",
        intent: "recommend",
      });
      submissionId = submission.id;

      const { error } = await supabase
        .from("event_exhibitors")
        .update({ content_submission_id: submission.id })
        .eq("id", candidate.row.id);
      if (error) throw error;

      candidate.row.content_submission_id = submission.id;
      created += 1;
      console.log(`${label} — created ${submission.id}`);
    } catch (err) {
      failed += 1;
      if (submissionId) {
        // The one non-atomic seam in this phase: the submission exists but the
        // roster row does not point at it, so a re-run would mint a duplicate.
        // Ceiling: an operator links it by hand. Upgrade path is a single RPC
        // that inserts and links in one transaction.
        console.error(
          `${label} — ORPHANED SUBMISSION ${submissionId}: link write-back failed (${describe(err)}). Link it manually before re-running, or the re-run will duplicate it.`,
        );
      } else {
        console.error(`${label} — FAILED: ${describe(err)}`);
      }
    }
  }

  console.log(`${LOG} submissions: created ${created}, failed ${failed}`);
}

// ---------------------------------------------------------------------------
// Phase 2 — run the real curation pipeline
// ---------------------------------------------------------------------------

async function runEnrichPhase(candidates: Candidate[]): Promise<void> {
  const linked = candidates.filter(
    (
      candidate,
    ): candidate is Candidate & { row: { content_submission_id: string } } =>
      Boolean(candidate.row.content_submission_id),
  );
  if (linked.length === 0) {
    console.log(`${LOG} enrich: nothing linked yet — run --submissions first`);
    return;
  }

  const pending = await loadPendingSubmissionIds(
    linked.map((candidate) => candidate.row.content_submission_id),
  );
  const ordered = applyLimit(
    linked
      .filter((candidate) =>
        pending.has(candidate.row.content_submission_id),
      )
      .sort((left, right) => {
        const leftRank = PRIORITY_ORDER.indexOf(
          left.ledger.reviewPriority as (typeof PRIORITY_ORDER)[number],
        );
        const rightRank = PRIORITY_ORDER.indexOf(
          right.ledger.reviewPriority as (typeof PRIORITY_ORDER)[number],
        );
        // An unknown priority sorts last rather than first.
        return (
          (leftRank < 0 ? PRIORITY_ORDER.length : leftRank) -
          (rightRank < 0 ? PRIORITY_ORDER.length : rightRank)
        );
      }),
  );

  console.log(
    `${LOG} enrich: ${linked.length} linked, ${ordered.length} still pending and selected`,
  );
  if (ordered.length === 0) return;
  if (DRY_RUN) {
    for (const candidate of ordered) {
      console.log(
        `${LOG}   would enrich (${candidate.ledger.reviewPriority}): ${candidate.row.content_submission_id} ${candidate.ledger.name}`,
      );
    }
    console.log(`${LOG} dry run — nothing enqueued`);
    return;
  }

  // Enrichment seeds from `website_url` only. The ledger's `sourceUrl` is a
  // creativexpo.tw listing page, and that host is on NON_BRAND_PLATFORM_HOSTS
  // (src/lib/services/enrich-phases/scraper/input-detector.ts), so passing it
  // anywhere would get the input refused.
  const submissionIds = ordered.map(
    (candidate) => candidate.row.content_submission_id,
  );

  const startedAt = Date.now();
  const job = await enqueueAdminCurationJob({
    params: { submissionIds, target: "submissions" },
    dryRun: false,
    startedBy: "operator-expo-roster",
  });
  console.log(`${LOG} enqueued job ${job.id}`);

  // No concurrency of our own: the pipeline already throttles with
  // ENRICH_CHUNK_SIZE = 20, ENRICH_BRAND_CONCURRENCY = 3, SCRAPE_DELAY_MS = 1000.
  const workerToken = randomUUID();
  const claimed = await claimCurationJob(job.id, workerToken);
  if (!claimed) throw new Error(`Could not claim job ${job.id}`);

  const summary = await runJob(claimed, workerToken);
  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
  console.log(`${LOG} enrich: finished in ${minutes}m`);
  console.log(`${LOG} ${JSON.stringify(summary)}`);
}

// ---------------------------------------------------------------------------
// Phase 3 — copy the content onto the roster row
// ---------------------------------------------------------------------------

async function harvestOne(
  candidate: Candidate & { row: { content_submission_id: string } },
): Promise<"harvested" | "skipped"> {
  const supabase = createServiceClient();
  const submissionId = candidate.row.content_submission_id;
  const label = `${LOG} ${candidate.ledger.name}`;

  // sort_order 0 IS the hero designation (classify-images.ts), so the lowest
  // active sort_order is the image the pipeline chose to lead with.
  const { data: heroRows, error: heroError } = await supabase
    .from("submission_images")
    .select("storage_path, alt_zh, alt_en")
    .eq("submission_id", submissionId)
    .eq("status", "active")
    .order("sort_order", { ascending: true })
    .limit(1);
  if (heroError) throw heroError;

  const hero = heroRows?.[0];
  if (!hero?.storage_path) {
    console.log(`${label} — SKIP (no active image)`);
    return "skipped";
  }

  const { data: submissionRows, error: submissionError } = await supabase
    .from("brand_submissions")
    .select("enriched_data")
    .eq("id", submissionId)
    .limit(1);
  if (submissionError) throw submissionError;

  const submissionRow = submissionRows?.[0];
  const rawEnriched = submissionRow?.enriched_data;
  const enriched =
    typeof rawEnriched === "object" &&
    rawEnriched !== null &&
    !Array.isArray(rawEnriched)
      ? enrichedDataFromDb(rawEnriched as Record<string, unknown>)
      : null;
  const summaryZh = enriched?.blurb ?? enriched?.description ?? null;
  const summaryEn = enriched?.blurbEn ?? enriched?.descriptionEn ?? null;

  if (DRY_RUN) {
    console.log(
      `${label} — would harvest ${hero.storage_path} + summary ${summaryZh ? "zh" : "-"}/${summaryEn ? "en" : "-"}`,
    );
    return "harvested";
  }

  // The COPY is the whole point: after it the roster row is self-sufficient and
  // survives rejection of the submission it came from. This is the repo's first
  // use of Supabase storage `.copy()`; the destination key is a fresh UUID, so
  // the default (idempotent) retry behaviour of uploadWithRetry is correct.
  const destination = `event-exhibitors/${candidate.row.id}/${randomUUID()}.webp`;
  const { error: copyError } = await uploadWithRetry(() =>
    supabase.storage.from(BUCKET).copy(hero.storage_path, destination),
  );
  if (copyError) throw copyError;

  const {
    data: { publicUrl },
  } = await uploadWithRetry(async () =>
    supabase.storage.from(BUCKET).getPublicUrl(destination),
  );

  const { error: updateError } = await supabase
    .from("event_exhibitors")
    .update({
      image_url: publicUrl,
      image_storage_path: destination,
      image_alt_zh: hero.alt_zh,
      image_alt_en: hero.alt_en,
      summary_zh: summaryZh,
      summary_en: summaryEn,
      content_source: "enriched",
      content_verified_at: new Date().toISOString(),
    })
    .eq("id", candidate.row.id);
  if (updateError) throw updateError;

  candidate.row.image_url = publicUrl;
  console.log(`${label} — harvested ${destination}`);
  return "harvested";
}

async function runHarvestPhase(candidates: Candidate[]): Promise<void> {
  const linked = candidates.filter(
    (
      candidate,
    ): candidate is Candidate & { row: { content_submission_id: string } } =>
      Boolean(candidate.row.content_submission_id),
  );
  // Already-harvested rows are skipped rather than re-copied: a second copy
  // would orphan the first object in the bucket for no gain. Ceiling: content
  // cannot be refreshed in place. Upgrade path is a --reharvest flag that
  // deletes the old image_storage_path after the new copy lands.
  const actionable = applyLimit(
    linked.filter((candidate) => !candidate.row.image_url),
  );

  console.log(
    `${LOG} harvest: ${linked.length} linked, ${linked.length - actionable.length} already harvested, ${actionable.length} selected`,
  );

  let harvested = 0;
  let skipped = 0;
  let failed = 0;
  for (const [index, candidate] of actionable.entries()) {
    const progress = `[${index + 1}/${actionable.length}]`;
    try {
      const outcome = await harvestOne(candidate);
      if (outcome === "harvested") harvested += 1;
      else skipped += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `${LOG} ${progress} ${candidate.ledger.name} — FAILED: ${describe(err)}`,
      );
    }
  }

  console.log(
    `${LOG} harvest: harvested ${harvested}, skipped ${skipped}, failed ${failed}${DRY_RUN ? " (dry run — nothing written)" : ""}`,
  );
}

// ---------------------------------------------------------------------------
// Phase 4 — retire the now-redundant submissions (destructive)
// ---------------------------------------------------------------------------

async function runRetirePhase(candidates: Candidate[]): Promise<void> {
  const linked = candidates.filter(
    (
      candidate,
    ): candidate is Candidate & { row: { content_submission_id: string } } =>
      Boolean(candidate.row.content_submission_id),
  );

  // Retiring an unharvested exhibitor is unrecoverable: reject_submission
  // deletes its submission_images rows and rejectSubmission then deletes the
  // storage objects, so the images would be gone with nothing copied.
  const unharvested = linked.filter((candidate) => !candidate.row.image_url);
  const actionable = applyLimit(
    linked.filter((candidate) => Boolean(candidate.row.image_url)),
  );

  const pending = await loadPendingSubmissionIds(
    actionable.map((candidate) => candidate.row.content_submission_id),
  );

  console.log(
    `${LOG} retire: ${linked.length} linked, ${unharvested.length} REFUSED (no image_url — run --harvest first), ${actionable.length} harvested and selected`,
  );
  for (const candidate of unharvested) {
    console.warn(
      `${LOG}   refusing ${candidate.ledger.name} (${candidate.row.content_submission_id}): nothing harvested`,
    );
  }
  if (actionable.length === 0) return;
  if (!YES || DRY_RUN) {
    for (const candidate of actionable) {
      console.log(
        `${LOG}   would retire ${candidate.row.content_submission_id} ${candidate.ledger.name}`,
      );
    }
    console.log(`${LOG} retire: DRY RUN — pass --yes to actually reject`);
    return;
  }

  const adminEmail = process.env.ADMIN_EMAILS?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  if (!adminEmail) {
    throw new Error("ADMIN_EMAILS must contain an admin account");
  }
  const reviewerId = await resolveReviewerId(adminEmail);

  let rejected = 0;
  let skipped = 0;
  let stillEnriching = 0;
  let failed = 0;
  for (const [index, candidate] of actionable.entries()) {
    const submissionId = candidate.row.content_submission_id;
    const label = `${LOG} [${index + 1}/${actionable.length}] ${candidate.ledger.name}`;

    if (!pending.has(submissionId)) {
      skipped += 1;
      console.log(`${label} — SKIP (no longer pending)`);
      continue;
    }

    try {
      await rejectSubmission(submissionId, reviewerId, "other", RETIRE_REASON);
      rejected += 1;
      console.log(`${label} — retired ${submissionId}`);
    } catch (err) {
      const message = describe(err);
      // Coupled to the `raise exception` text in reject_submission, not to an
      // error code — the function is hand-patched in prod with no canonical
      // source file, so rewording the exception downgrades these BLOCKED lines
      // to generic FAILED. Switch to a SQLSTATE check if this script outlives
      // the expo.
      if (message.includes("Submission enrichment is still active")) {
        stillEnriching += 1;
        console.error(
          `${label} — BLOCKED: a curation job for ${submissionId} is still pending or running. Wait for the enrichment jobs to finish, then re-run --retire.`,
        );
        continue;
      }
      failed += 1;
      console.error(`${label} — FAILED: ${message}`);
    }
  }

  console.log(
    `${LOG} retire: rejected ${rejected}, skipped ${skipped}, still enriching ${stillEnriching}, failed ${failed}`,
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const selectedPhases = Object.entries(PHASES).filter(([, on]) => on);
  if (selectedPhases.length === 0) {
    console.log(
      `${LOG} no phase selected. Pass one or more of --adopt --submissions --enrich --harvest --retire ` +
        `(plus --dry-run, --limit=N, and --yes for --retire).`,
    );
    return;
  }

  const eventId = await resolveEventId();
  const ledger = await loadLedgerCandidates();
  const candidates = await loadCandidates(eventId, ledger);
  console.log(
    `${LOG} event ${EVENT_SLUG}: ${ledger.length} enrichable ledger record(s), ${candidates.length} matched roster row(s)`,
  );

  // Phases share the in-memory candidate list, so running several in one
  // invocation sees the previous phase's writes without a re-read.
  // Adopt runs first on purpose: --submissions decides what to create from
  // `content_submission_id is null`, so an un-adopted exhibitor would get a
  // duplicate submission minted for it.
  if (PHASES.adopt) await runAdoptPhase(candidates);
  if (PHASES.submissions) await runSubmissionsPhase(candidates);
  if (PHASES.enrich) await runEnrichPhase(candidates);
  if (PHASES.harvest) await runHarvestPhase(candidates);
  if (PHASES.retire) await runRetirePhase(candidates);
}

main().catch((err) => {
  console.error(`${LOG} fatal:`, err);
  process.exit(1);
});
