/**
 * One-time Taiwan-first bilingual name publication.
 *
 * Preparation (production): take the full cohort snapshot, then run the
 * identity curation task with --no-apply so refresh rows hold only proposals.
 * This command consumes those successful refreshes in bounded, resumable
 * batches and writes only brands.name through the audited admin service.
 *
 *   pnpm brand-names:backfill --cohort 2026-08-30-latin-only --dry-run
 *   pnpm brand-names:backfill --cohort 2026-08-30-latin-only --confirm --slugs=lid-shoes
 *   pnpm brand-names:backfill --cohort 2026-08-30-latin-only --confirm --batch-size=25
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { requestPublicBrandRevalidation } from "@/lib/cache/revalidate-client";
import { updateBrand } from "@/lib/services/brands";
import { rejectSubmission } from "@/lib/services/submissions";
import { createServiceClient } from "@/lib/supabase/service";
import { loadCohort, snapshotDir, type Cohort } from "../curation-rerun/cohort";
import {
  evaluateNameBackfillEligibility,
  isIdentityBackfillJobForSubmission,
  isResumableNameBackfillWrite,
  parseNameBackfillMode,
  type NameBackfillBrand,
  type NameBackfillJob,
  type NameBackfillWriteEvent,
} from "./policy";
import { loadScriptTarget } from "../shared/target";

type RefreshRow = {
  id: string;
  brand_id: string;
  brand_name: string;
  base_brand_data: unknown;
  enriched_data: unknown;
};

type TargetRow = {
  target_id: string;
  job_id: string;
  status: string;
  created_at: string;
  id: string;
};

type SnapshotFile = {
  capturedAt: string;
  cohort: string;
  slugs: string[];
  brands: unknown[];
  children: Record<string, unknown[]>;
};

const REQUIRED_SNAPSHOT_CHILDREN = [
  "brand_images",
  "brand_faq_entries",
  "brand_channels",
] as const;

type AuditEntry = {
  slug: string;
  brandId: string;
  submissionId: string;
  jobId: string;
  oldName: string;
  newName: string | null;
  evidence: unknown[];
  outcome:
    | "applied"
    | "resumed"
    | "skipped"
    | "failed"
    | "would-apply"
    | "would-resume"
    | "would-skip";
  note: string;
};

function argValue(flag: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv.at(index + 1);
}

function selectedSlugs(cohort: Cohort): string[] {
  const raw = argValue("--slugs");
  if (!raw) return [...cohort.slugs];
  const slugs = [
    ...new Set(
      raw
        .split(",")
        .map((slug) => slug.trim())
        .filter(Boolean),
    ),
  ];
  const unknown = slugs.filter((slug) => !cohort.slugs.includes(slug));
  if (unknown.length > 0) {
    throw new Error(
      `slug(s) not in cohort ${cohort.name}: ${unknown.join(", ")}`,
    );
  }
  return slugs;
}

function batchSize(): number {
  const raw = argValue("--batch-size") ?? "25";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error("--batch-size must be an integer from 1 to 100");
  }
  return value;
}

function toBrand(value: unknown): NameBackfillBrand | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.slug !== "string" ||
    typeof row.name !== "string" ||
    typeof row.status !== "string"
  ) {
    return null;
  }
  const optionalText = (key: string): string | null | undefined =>
    typeof row[key] === "string"
      ? row[key]
      : row[key] === null
        ? null
        : undefined;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    purchase_website: optionalText("purchase_website"),
    social_instagram: optionalText("social_instagram"),
    social_threads: optionalText("social_threads"),
    social_facebook: optionalText("social_facebook"),
  };
}

function proposalFrom(row: RefreshRow): unknown {
  if (
    typeof row.enriched_data !== "object" ||
    row.enriched_data === null ||
    Array.isArray(row.enriched_data)
  ) {
    return null;
  }
  return (row.enriched_data as Record<string, unknown>)._name_proposal;
}

function proposalEvidence(proposal: unknown): unknown[] {
  if (
    typeof proposal !== "object" ||
    proposal === null ||
    Array.isArray(proposal)
  ) {
    return [];
  }
  const evidence = (proposal as Record<string, unknown>).evidence;
  return Array.isArray(evidence) ? evidence : [];
}

function proposalValue(proposal: unknown): string | null {
  if (
    typeof proposal !== "object" ||
    proposal === null ||
    Array.isArray(proposal)
  ) {
    return null;
  }
  const value = (proposal as Record<string, unknown>).value;
  return typeof value === "string" ? value : null;
}

async function loadCompleteSnapshot(cohort: Cohort): Promise<SnapshotFile> {
  const path = resolve(
    snapshotDir(cohort),
    argValue("--snapshot") ?? "before.json",
  );
  const parsed = JSON.parse(
    await readFile(path, "utf8"),
  ) as Partial<SnapshotFile>;
  if (
    parsed.cohort !== cohort.name ||
    !parsed.capturedAt ||
    !Array.isArray(parsed.slugs) ||
    !Array.isArray(parsed.brands) ||
    typeof parsed.children !== "object" ||
    parsed.children === null ||
    REQUIRED_SNAPSHOT_CHILDREN.some(
      (table) => !Array.isArray(parsed.children?.[table]),
    )
  ) {
    throw new Error(
      `snapshot is incomplete or belongs to another cohort: ${path}`,
    );
  }
  const captured = new Set(parsed.slugs);
  const brandSlugs = new Set(
    parsed.brands.flatMap((brand) => {
      const parsedBrand = toBrand(brand);
      return parsedBrand ? [parsedBrand.slug] : [];
    }),
  );
  const missing = cohort.slugs.filter(
    (slug) => !captured.has(slug) || !brandSlugs.has(slug),
  );
  if (missing.length > 0 || parsed.brands.length !== cohort.slugs.length) {
    throw new Error(
      `snapshot is not a complete ${cohort.name} backup; missing: ${missing.join(", ") || "count mismatch"}`,
    );
  }
  return parsed as SnapshotFile;
}

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

async function latestSuccessfulTargets(
  ids: string[],
): Promise<Map<string, TargetRow>> {
  const supabase = createServiceClient();
  const latest = new Map<string, TargetRow>();
  for (let index = 0; index < ids.length; index += 200) {
    const chunk = ids.slice(index, index + 200);
    const { data, error } = await supabase
      .from("curation_job_targets")
      .select("target_id, job_id, status, created_at, id")
      .eq("target_type", "submission")
      .in("target_id", chunk)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw error;
    for (const raw of data ?? []) {
      const row = raw as TargetRow;
      if (!latest.has(row.target_id)) latest.set(row.target_id, row);
    }
  }
  const succeeded = [...latest].filter(
    ([, target]) => target.status === "succeeded",
  );
  const jobIds = [...new Set(succeeded.map(([, target]) => target.job_id))];
  if (jobIds.length === 0) return new Map();
  const { data: jobData, error: jobError } = await supabase
    .from("curation_jobs")
    .select("id, status, operation, dry_run, params")
    .in("id", jobIds);
  if (jobError) throw jobError;
  const jobs = new Map(
    (jobData ?? []).map((job) => [job.id, job as NameBackfillJob]),
  );
  return new Map(
    succeeded.filter(([, target]) => {
      const job = jobs.get(target.job_id);
      return job && isIdentityBackfillJobForSubmission(job, target.target_id);
    }),
  );
}

async function appliedNameEvents(
  brandIds: string[],
  jobIds: string[],
): Promise<Map<string, NameBackfillWriteEvent>> {
  if (brandIds.length === 0 || jobIds.length === 0) return new Map();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("brand_field_events")
    .select("brand_id, field, source, job_id, old_value, new_value")
    .eq("field", "name")
    .eq("source", "admin")
    .in("brand_id", brandIds)
    .in("job_id", jobIds)
    .order("id", { ascending: false });
  if (error) throw error;
  const events = new Map<string, NameBackfillWriteEvent>();
  for (const event of data ?? []) {
    if (!event.job_id) continue;
    const key = `${event.brand_id}:${event.job_id}`;
    if (!events.has(key)) events.set(key, event);
  }
  return events;
}

async function writeAudit(
  cohort: Cohort,
  mode: string,
  entries: AuditEntry[],
  revalidation: { ok: boolean; reason?: string },
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const path = resolve(
    snapshotDir(cohort),
    `name-backfill-${timestamp}-${mode}.json`,
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify(
      {
        cohort: cohort.name,
        mode,
        recordedAt: new Date().toISOString(),
        revalidation,
        entries,
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  return path;
}

async function main(): Promise<void> {
  const { argv } = loadScriptTarget();
  const mode = parseNameBackfillMode(argv);
  const cohort = await loadCohort();
  const slugs = selectedSlugs(cohort);
  const limit = batchSize();
  const standardSnapshot =
    mode === "confirm" ? await loadCompleteSnapshot(cohort) : null;
  const standardBySlug = new Map(
    (standardSnapshot?.brands ?? []).flatMap((brand) => {
      const parsed = toBrand(brand);
      return parsed ? [[parsed.slug, parsed] as const] : [];
    }),
  );

  const supabase = createServiceClient();
  const { data: currentData, error: currentError } = await supabase
    .from("brands")
    .select(
      "id, slug, name, status, purchase_website, social_instagram, social_threads, social_facebook",
    )
    .in("slug", slugs);
  if (currentError) throw currentError;
  const currentBrands = (currentData ?? []).flatMap((row) => {
    const brand = toBrand(row);
    return brand ? [brand] : [];
  });
  const currentById = new Map(currentBrands.map((brand) => [brand.id, brand]));
  const missingSlugs = slugs.filter(
    (slug) => !currentBrands.some((brand) => brand.slug === slug),
  );
  if (missingSlugs.length > 0) {
    throw new Error(`cohort brands not found: ${missingSlugs.join(", ")}`);
  }

  const { data: refreshData, error: refreshError } = await supabase
    .from("brand_submissions")
    .select("id, brand_id, brand_name, base_brand_data, enriched_data")
    .eq("intent", "refresh")
    .eq("status", "pending")
    .in(
      "brand_id",
      currentBrands.map((brand) => brand.id),
    );
  if (refreshError) throw refreshError;
  const refreshes = (refreshData ?? []).filter(
    (row): row is typeof row & { brand_id: string } =>
      typeof row.brand_id === "string",
  ) as RefreshRow[];
  const successfulTargets = await latestSuccessfulTargets(
    refreshes.map((row) => row.id),
  );
  const successful = refreshes
    .filter((row) => successfulTargets.has(row.id))
    .sort((left, right) => {
      const leftSlug = currentById.get(left.brand_id)?.slug ?? "";
      const rightSlug = currentById.get(right.brand_id)?.slug ?? "";
      return slugs.indexOf(leftSlug) - slugs.indexOf(rightSlug);
    })
    .slice(0, limit);
  const priorWrites = await appliedNameEvents(
    successful.map((refresh) => refresh.brand_id),
    successful.flatMap((refresh) => {
      const target = successfulTargets.get(refresh.id);
      return target ? [target.job_id] : [];
    }),
  );

  console.log(
    `[brand-name-backfill] mode=${mode} cohort=${cohort.name} selected=${slugs.length} successful-pending=${successful.length} batch-size=${limit}`,
  );

  const adminEmail = process.env.ADMIN_EMAILS?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  if (mode === "confirm" && !adminEmail) {
    throw new Error("ADMIN_EMAILS must contain an admin account");
  }
  const reviewerId =
    mode === "confirm" ? await resolveReviewerId(adminEmail!) : "";
  const audit: AuditEntry[] = [];
  const appliedSlugs: string[] = [];

  for (const [index, refresh] of successful.entries()) {
    const current = currentById.get(refresh.brand_id);
    const target = successfulTargets.get(refresh.id);
    if (!current || !target) {
      throw new Error(`successful refresh ${refresh.id} lost its brand or target`);
    }
    const proposal = proposalFrom(refresh);
    const evidence = proposalEvidence(proposal);
    const proposedValue = proposalValue(proposal);
    const snapshot = toBrand(refresh.base_brand_data);
    const label = `[${index + 1}/${successful.length}] ${current.slug}`;
    if (!snapshot) {
      const note =
        "Name-only backfill skipped: refresh snapshot is invalid. Other enrichment was intentionally discarded.";
      console.log(`${label} — ${mode === "confirm" ? "SKIP" : "would skip"}: invalid refresh snapshot`);
      if (mode === "confirm") {
        await rejectSubmission(refresh.id, reviewerId, "other", note);
      }
      audit.push({
        slug: current.slug,
        brandId: current.id,
        submissionId: refresh.id,
        jobId: target.job_id,
        oldName: refresh.brand_name,
        newName: proposedValue,
        evidence,
        outcome: mode === "confirm" ? "skipped" : "would-skip",
        note,
      });
      continue;
    }
    const standard = standardBySlug.get(current.slug);
    const standardMismatch =
      standard &&
      (standard.id !== snapshot.id ||
        standard.slug !== snapshot.slug ||
        standard.name !== snapshot.name);
    const decision = standardMismatch
      ? {
          eligible: false as const,
          reason: "refresh snapshot does not match the complete backup",
        }
      : evaluateNameBackfillEligibility({ current, snapshot, proposal });
    const priorWrite = priorWrites.get(`${current.id}:${target.job_id}`);
    if (
      !standardMismatch &&
      isResumableNameBackfillWrite({
        current,
        snapshot,
        proposal,
        event: priorWrite,
        jobId: target.job_id,
      })
    ) {
      const note =
        "Name-only proposal was already applied through the audited updateBrand path; this resumed run closed the refresh and discarded all other enrichment.";
      console.log(
        `${label} — ${mode === "confirm" ? "resume" : "would resume"}: ${current.name}`,
      );
      if (mode === "confirm") {
        await rejectSubmission(refresh.id, reviewerId, "other", note);
        appliedSlugs.push(current.slug);
      }
      audit.push({
        slug: current.slug,
        brandId: current.id,
        submissionId: refresh.id,
        jobId: target.job_id,
        oldName: snapshot.name,
        newName: current.name,
        evidence,
        outcome: mode === "confirm" ? "resumed" : "would-resume",
        note,
      });
      continue;
    }

    if (!decision.eligible) {
      const note = `Name-only backfill skipped: ${decision.reason}. Other enrichment was intentionally discarded.`;
      console.log(
        `${label} — ${mode === "confirm" ? "SKIP" : "would skip"}: ${decision.reason}`,
      );
      if (mode === "confirm") {
        await rejectSubmission(refresh.id, reviewerId, "other", note);
      }
      audit.push({
        slug: current.slug,
        brandId: current.id,
        submissionId: refresh.id,
        jobId: target.job_id,
        oldName: current.name,
        newName: proposedValue,
        evidence,
        outcome: mode === "confirm" ? "skipped" : "would-skip",
        note,
      });
      continue;
    }

    if (mode === "dry-run") {
      console.log(
        `${label} — would apply: ${current.name} -> ${decision.proposal.value}`,
      );
      audit.push({
        slug: current.slug,
        brandId: current.id,
        submissionId: refresh.id,
        jobId: target.job_id,
        oldName: current.name,
        newName: decision.proposal.value,
        evidence: decision.proposal.evidence,
        outcome: "would-apply",
        note: "Dry run; no write or submission closure performed.",
      });
      continue;
    }

    try {
      const updated = await updateBrand(
        current.id,
        { name: decision.proposal.value },
        { source: "admin", userId: reviewerId, jobId: target.job_id },
      );
      if (
        updated.name !== decision.proposal.value ||
        updated.slug !== current.slug
      ) {
        throw new Error("post-write verification failed or slug changed");
      }
      const note =
        "Name-only proposal applied through audited updateBrand; all other enrichment was intentionally discarded.";
      await rejectSubmission(refresh.id, reviewerId, "other", note);
      appliedSlugs.push(current.slug);
      console.log(`${label} — applied: ${current.name} -> ${updated.name}`);
      audit.push({
        slug: current.slug,
        brandId: current.id,
        submissionId: refresh.id,
        jobId: target.job_id,
        oldName: current.name,
        newName: updated.name,
        evidence: decision.proposal.evidence,
        outcome: "applied",
        note,
      });
    } catch (error) {
      const note =
        error instanceof Error ? error.message : JSON.stringify(error);
      console.error(`${label} — FAILED: ${note}`);
      audit.push({
        slug: current.slug,
        brandId: current.id,
        submissionId: refresh.id,
        jobId: target.job_id,
        oldName: current.name,
        newName: decision.proposal.value,
        evidence: decision.proposal.evidence,
        outcome: "failed",
        note,
      });
    }
  }

  const revalidation =
    mode === "confirm"
      ? await requestPublicBrandRevalidation(appliedSlugs)
      : { ok: true, reason: "dry-run" };
  const auditPath = await writeAudit(cohort, mode, audit, revalidation);
  console.log(
    `[brand-name-backfill] applied=${audit.filter((entry) => entry.outcome === "applied" || entry.outcome === "resumed").length} skipped=${audit.filter((entry) => entry.outcome === "skipped").length} failed=${audit.filter((entry) => entry.outcome === "failed").length}`,
  );
  console.log(`[brand-name-backfill] audit=${auditPath}`);
}

void main().catch((error) => {
  console.error(
    "[brand-name-backfill] fatal:",
    error instanceof Error ? error.message : JSON.stringify(error),
  );
  process.exitCode = 1;
});
