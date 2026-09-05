/**
 * Field-level before/after census of a cohort's brands.
 *
 * Registry metadata: class `operator`, target `staging-default`, safety
 * `read-only`. The marker block itself lives in `scripts/dev-1644/README.md` —
 * the registry gate allows exactly one header-bearing entry per directory, so a
 * second one here would fail `pnpm check:script-registry`.
 *
 * Run it once before a curation run and once after; `--diff` turns the two
 * files into the per-brand, per-field table the proof artifact needs. The
 * client structurally cannot write (`createWriteBlockingClient`) and the target
 * guard refuses the production project unless it is named twice.
 *
 *   pnpm exec tsx --env-file=.env.staging scripts/dev-1644/brand-census.ts \
 *     --cohort dev-1644-routing-pilot --out docs/dev-1644/census-before.json
 *   pnpm exec tsx scripts/dev-1644/brand-census.ts --diff before.json after.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { detectAiArtifacts } from "@/lib/services/enrich-validators";
import { parsePhaseResults } from "@/lib/services/phase-results";
import { PRODUCTION_PROJECT_REF } from "@/lib/supabase/project-target";
import type { Json } from "@/lib/supabase/database.types";
import type { PhaseResult } from "@/lib/types/curation";

import { loadCohort } from "../curation-rerun/cohort";
import { createWriteBlockingClient } from "../lib/readonly-client";
import { loadScriptTarget } from "../shared/target";

// ---------------------------------------------------------------------------
// Types — exported for tests
// ---------------------------------------------------------------------------

export type TextStat = { length: number; aiArtifactHits: number };

export type CensusRow = {
  slug: string;
  name: string;
  /** `brands.status` — the census exists to catch `approved` leaving. */
  status: string;
  /**
   * `brands.hidden_reason` — why a hidden brand is hidden. Null on every
   * approved brand, so a value here is always the reason for the last hide.
   */
  hidden_reason: string | null;
  /**
   * `brand_submissions.denial_reason` of the brand's most recently reviewed
   * denied submission. Null when no submission for this brand was denied.
   */
  submission_denial_reason: string | null;
  /**
   * Distinct `linkExpansion.adopted[].source` values of the latest curation
   * target's acquire phase, comma joined in first-adopted order. Empty string
   * when the last run adopted no link.
   */
  link_sources: string;
  purchase_website: string | null;
  social_instagram: string | null;
  social_threads: string | null;
  social_facebook: string | null;
  description: TextStat;
  description_en: TextStat;
  blurb: TextStat;
  blurb_en: TextStat;
  active_image_count: number;
  hero_storage_path: string | null;
  /** Active images in a gallery slot — `sort_order` 1 through 9; 0 is the hero. */
  gallery_count: number;
  stockists_count: number;
  faq_count: number;
  visible_products: number;
  products_link_checked: number;
  products_mit_confirmed: number;
  products_with_image: number;
  /** Number of products in the pending refresh submission's enriched_data. */
  pending_products: number;
  /** Curated product candidates with a final_rank for the pending submission. */
  pending_candidate_rank_count: number;
  /** Active images in the pending submission. */
  pending_active_images: number;
  /** Candidate images in the pending submission. */
  pending_candidate_images: number;
};

/**
 * A submission-only census row — emitted by `--submission-ids` for submissions
 * that have no linked brand row.
 */
export type SubmissionCensusRow = {
  submission_id: string;
  slug: null;
  /** `brand_submissions.denial_reason`; null while the submission is pending. */
  submission_denial_reason: string | null;
  pending_products: number;
  pending_candidate_rank_count: number;
  pending_active_images: number;
  pending_candidate_images: number;
};

export type CensusFile = {
  cohort: string;
  capturedAt: string;
  rows: CensusRow[];
};

export type FieldDirection =
  | "improved"
  | "regressed"
  | "unchanged"
  /** A different value that is neither better nor worse — a swapped link. */
  | "changed";

export type FieldDiff = {
  field: string;
  before: string;
  after: string;
  direction: FieldDirection;
};

/** The first gallery slot; `sort_order` 0 is the hero, not a gallery photo. */
const FIRST_GALLERY_SLOT = 1;
/** The last gallery slot — `MAX_BRAND_GALLERY_PHOTOS` in the image constants. */
const LAST_GALLERY_SLOT = 9;

// ---------------------------------------------------------------------------
// Target guard
// ---------------------------------------------------------------------------

/**
 * Refuses to census production unless BOTH `--target production` and
 * `--confirm` are present.
 *
 * `loadScriptTarget` already proves the credentials belong to the declared
 * target, so the URL check here is the second, independent half: a production
 * project reached under any weaker declaration is a mistake, not a shortcut.
 * Nothing but the public project ref is ever printed.
 */
export function assertCensusTarget(input: {
  supabaseUrl: string;
  target: string;
  confirmed: boolean;
}): void {
  if (!input.supabaseUrl.includes(PRODUCTION_PROJECT_REF)) return;

  if (input.target !== "production") {
    throw new Error(
      `Refusing to run: the resolved Supabase URL names the production project ${PRODUCTION_PROJECT_REF} while --target says ${input.target}`,
    );
  }
  if (!input.confirmed) {
    throw new Error(
      `Refusing to run against production project ${PRODUCTION_PROJECT_REF} without --confirm`,
    );
  }
}

// ---------------------------------------------------------------------------
// Per-field statistics
// ---------------------------------------------------------------------------

export function textStat(
  value: string | null | undefined,
  locale: "zh" | "en",
): TextStat {
  const text = value ?? "";
  if (text.length === 0) return { length: 0, aiArtifactHits: 0 };
  return {
    length: text.length,
    aiArtifactHits: detectAiArtifacts(text, locale).length,
  };
}

export function countGallery(
  images: ReadonlyArray<{ sort_order: number }>,
): number {
  return images.filter(
    (image) =>
      image.sort_order >= FIRST_GALLERY_SLOT &&
      image.sort_order <= LAST_GALLERY_SLOT,
  ).length;
}

export type ProductRow = {
  visible: boolean;
  link_state: string | null;
  link_checked_at: string | null;
  made_in_taiwan_confirmed: boolean | null;
  image_url: string | null;
};

export function summarizeProductRows(rows: ReadonlyArray<ProductRow>): {
  visible: number;
  linkChecked: number;
  mitConfirmed: number;
  withImage: number;
} {
  const visible = rows.filter((row) => row.visible);
  return {
    visible: visible.length,
    linkChecked: visible.filter((row) => row.link_checked_at !== null).length,
    mitConfirmed: visible.filter((row) => row.made_in_taiwan_confirmed === true)
      .length,
    withImage: visible.filter(
      (row) => typeof row.image_url === "string" && row.image_url.length > 0,
    ).length,
  };
}

export function emptyCensusRow(slug: string): CensusRow {
  const zero: TextStat = { length: 0, aiArtifactHits: 0 };
  return {
    slug,
    name: "",
    status: "approved",
    hidden_reason: null,
    submission_denial_reason: null,
    link_sources: "",
    purchase_website: null,
    social_instagram: null,
    social_threads: null,
    social_facebook: null,
    description: { ...zero },
    description_en: { ...zero },
    blurb: { ...zero },
    blurb_en: { ...zero },
    active_image_count: 0,
    hero_storage_path: null,
    gallery_count: 0,
    stockists_count: 0,
    faq_count: 0,
    visible_products: 0,
    products_link_checked: 0,
    products_mit_confirmed: 0,
    products_with_image: 0,
    pending_products: 0,
    pending_candidate_rank_count: 0,
    pending_active_images: 0,
    pending_candidate_images: 0,
  };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

type CountField = {
  kind: "count";
  field: string;
  get: (row: CensusRow) => number;
  /** `lower` is the AI-artifact case: fewer hits is a better brand page. */
  better: "higher" | "lower";
};

type TextField = {
  kind: "text";
  field: string;
  get: (row: CensusRow) => string | null;
  /**
   * Overrides the empty-in / empty-out reading of `textDirection`. Only
   * `status` needs it: both sides are always non-empty, and a brand leaving
   * the directory has a direction that "changed" would hide.
   */
  directionOf?: (before: string | null, after: string | null) => FieldDirection;
};

type FieldSpec = CountField | TextField;

function textPair(
  field: keyof Pick<
    CensusRow,
    "description" | "description_en" | "blurb" | "blurb_en"
  >,
): FieldSpec[] {
  return [
    {
      kind: "count",
      field: `${field}.length`,
      get: (row) => row[field].length,
      better: "higher",
    },
    {
      kind: "count",
      field: `${field}.ai_artifact_hits`,
      get: (row) => row[field].aiArtifactHits,
      better: "lower",
    },
  ];
}

/** Fixed order: the diff is read side by side across runs. */
const FIELD_SPECS: FieldSpec[] = [
  { kind: "text", field: "name", get: (row) => row.name },
  {
    kind: "text",
    field: "status",
    get: (row) => row.status,
    directionOf: statusDirection,
  },
  { kind: "text", field: "hidden_reason", get: (row) => row.hidden_reason },
  {
    kind: "text",
    field: "submission_denial_reason",
    get: (row) => row.submission_denial_reason,
  },
  { kind: "text", field: "link_sources", get: (row) => row.link_sources },
  {
    kind: "text",
    field: "purchase_website",
    get: (row) => row.purchase_website,
  },
  {
    kind: "text",
    field: "social_instagram",
    get: (row) => row.social_instagram,
  },
  { kind: "text", field: "social_threads", get: (row) => row.social_threads },
  { kind: "text", field: "social_facebook", get: (row) => row.social_facebook },
  ...textPair("description"),
  ...textPair("description_en"),
  ...textPair("blurb"),
  ...textPair("blurb_en"),
  {
    kind: "count",
    field: "active_image_count",
    get: (row) => row.active_image_count,
    better: "higher",
  },
  {
    kind: "text",
    field: "hero_storage_path",
    get: (row) => row.hero_storage_path,
  },
  {
    kind: "count",
    field: "gallery_count",
    get: (row) => row.gallery_count,
    better: "higher",
  },
  {
    kind: "count",
    field: "stockists_count",
    get: (row) => row.stockists_count,
    better: "higher",
  },
  {
    kind: "count",
    field: "faq_count",
    get: (row) => row.faq_count,
    better: "higher",
  },
  {
    kind: "count",
    field: "visible_products",
    get: (row) => row.visible_products,
    better: "higher",
  },
  {
    kind: "count",
    field: "products_link_checked",
    get: (row) => row.products_link_checked,
    better: "higher",
  },
  {
    kind: "count",
    field: "products_mit_confirmed",
    get: (row) => row.products_mit_confirmed,
    better: "higher",
  },
  {
    kind: "count",
    field: "products_with_image",
    get: (row) => row.products_with_image,
    better: "higher",
  },
  {
    kind: "count",
    field: "pending_products",
    get: (row) => row.pending_products,
    better: "higher",
  },
  {
    kind: "count",
    field: "pending_candidate_rank_count",
    get: (row) => row.pending_candidate_rank_count,
    better: "higher",
  },
  {
    kind: "count",
    field: "pending_active_images",
    get: (row) => row.pending_active_images,
    better: "higher",
  },
  {
    kind: "count",
    field: "pending_candidate_images",
    get: (row) => row.pending_candidate_images,
    better: "higher",
  },
];

function displayText(value: string | null): string {
  return value === null || value === "" ? "-" : value;
}

function countDirection(
  before: number,
  after: number,
  better: "higher" | "lower",
): FieldDirection {
  if (before === after) return "unchanged";
  const up = after > before;
  return (better === "higher") === up ? "improved" : "regressed";
}

/**
 * A text field only has a direction when one side is empty: filling a blank is
 * an improvement and clearing it is a regression. A DIFFERENT non-empty value
 * is reported as `changed` — a swapped website may be a correction or a
 * hijack, and this script is not the thing that can tell them apart.
 */
function textDirection(
  before: string | null,
  after: string | null,
): FieldDirection {
  const beforeEmpty = before === null || before === "";
  const afterEmpty = after === null || after === "";
  if (beforeEmpty && afterEmpty) return "unchanged";
  if (beforeEmpty) return "improved";
  if (afterEmpty) return "regressed";
  return before === after ? "unchanged" : "changed";
}

/**
 * `approved -> hidden` is a regression and `hidden -> approved` an improvement,
 * whatever hid the brand. A channel verdict that delists a brand is the outcome
 * the proof run is looking for, so it must never read as a neutral "changed".
 */
export function statusDirection(
  before: string | null,
  after: string | null,
): FieldDirection {
  if (before === after) return "unchanged";
  if (before === "approved" && after === "hidden") return "regressed";
  if (before === "hidden" && after === "approved") return "improved";
  return "changed";
}

/**
 * Which deterministic sources fed the brand's adopted links on its LAST
 * curation run — `hub`, `threads`, `serp`, `serp_handle`. Distinct, in
 * first-adopted order, comma joined; empty when nothing was adopted.
 *
 * Reads the last `acquire` entry only. An earlier attempt's expansion is not
 * what the current column values came from.
 */
export function linkSourcesFromPhaseResults(
  results: ReadonlyArray<PhaseResult>,
): string {
  const acquire = results.filter((result) => result.phase === "acquire").at(-1);
  const adopted = acquire?.linkExpansion?.adopted ?? [];
  return [...new Set(adopted.map((entry) => entry.source))].join(",");
}

export function diffRow(before: CensusRow, after: CensusRow): FieldDiff[] {
  return FIELD_SPECS.map((spec) => {
    if (spec.kind === "count") {
      const b = spec.get(before);
      const a = spec.get(after);
      return {
        field: spec.field,
        before: String(b),
        after: String(a),
        direction: countDirection(b, a, spec.better),
      };
    }
    const b = spec.get(before);
    const a = spec.get(after);
    return {
      field: spec.field,
      before: displayText(b),
      after: displayText(a),
      direction: (spec.directionOf ?? textDirection)(b, a),
    };
  });
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderCensusDiff(before: CensusFile, after: CensusFile): string {
  const beforeBySlug = new Map(before.rows.map((row) => [row.slug, row]));
  const afterBySlug = new Map(after.rows.map((row) => [row.slug, row]));
  const slugs = [
    ...new Set([...beforeBySlug.keys(), ...afterBySlug.keys()]),
  ].sort();

  const totals: Record<FieldDirection, number> = {
    improved: 0,
    regressed: 0,
    changed: 0,
    unchanged: 0,
  };

  const lines: string[] = [
    `# Cohort census diff — ${before.cohort}`,
    "",
    `before ${before.capturedAt} → after ${after.capturedAt}`,
    "",
  ];

  for (const slug of slugs) {
    const beforeRow = beforeBySlug.get(slug);
    const afterRow = afterBySlug.get(slug);
    lines.push(`## ${slug}`, "");

    if (!beforeRow || !afterRow) {
      lines.push(
        `missing from ${beforeRow ? "after" : "before"} — not compared`,
        "",
      );
      continue;
    }

    lines.push("| field | before | after | change |");
    lines.push("| --- | --- | --- | --- |");
    for (const diff of diffRow(beforeRow, afterRow)) {
      totals[diff.direction] += 1;
      lines.push(
        `| ${cell(diff.field)} | ${cell(diff.before)} | ${cell(diff.after)} | ${diff.direction} |`,
      );
    }
    lines.push("");
  }

  lines.push(
    `Totals: improved ${totals.improved} / unchanged ${totals.unchanged} / regressed ${totals.regressed} / changed ${totals.changed}`,
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Database read (not tested — integration only)
// ---------------------------------------------------------------------------

type SupabaseLike = ReturnType<typeof createWriteBlockingClient>["client"];

/**
 * PostgREST caps a response at `max-rows` and reports the cap as an ordinary
 * short result. Page to exhaustion; a short page ends it.
 */
const PAGE = 1000;

async function selectAllPages<T>(
  run: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(`${label} query failed: ${error.message}`);
    const page = data ?? [];
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

type BrandRecord = {
  id: string;
  slug: string;
  name: string;
  status: string;
  hidden_reason: string | null;
  purchase_website: string | null;
  social_instagram: string | null;
  social_threads: string | null;
  social_facebook: string | null;
  description: string | null;
  description_en: string | null;
  blurb: string | null;
  blurb_en: string | null;
  hero_image_storage_path: string | null;
};

type ImageRecord = {
  brand_id: string;
  sort_order: number;
  storage_path: string | null;
};

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(key(row));
    if (bucket) bucket.push(row);
    else grouped.set(key(row), [row]);
  }
  return grouped;
}

async function fetchCensus(
  client: SupabaseLike,
  slugs: string[],
): Promise<CensusRow[]> {
  const { data: brands, error } = await client
    .from("brands")
    .select(
      "id, slug, name, status, hidden_reason, purchase_website, social_instagram, social_threads, social_facebook, description, description_en, blurb, blurb_en, hero_image_storage_path",
    )
    .in("slug", slugs);
  if (error) throw new Error(`brands query failed: ${error.message}`);

  const brandRows = (brands ?? []) as BrandRecord[];
  const ids = brandRows.map((brand) => brand.id);
  if (ids.length === 0) return [];

  const images = await selectAllPages<ImageRecord>(
    (from, to) =>
      client
        .from("brand_images")
        .select("brand_id, sort_order, storage_path")
        .in("brand_id", ids)
        .eq("status", "active")
        // Paging needs a TOTAL order or rows shift between pages; `id` is the
        // only column that is unique per row here.
        .order("id", { ascending: true })
        .range(from, to),
    "brand_images",
  );

  const channels = await selectAllPages<{
    brand_id: string;
    removed_at: string | null;
  }>(
    (from, to) =>
      client
        .from("brand_channels")
        .select("brand_id, removed_at")
        .in("brand_id", ids)
        .order("id", { ascending: true })
        .range(from, to),
    "brand_channels",
  );

  const faqs = await selectAllPages<{ brand_id: string }>(
    (from, to) =>
      client
        .from("brand_faq_entries")
        .select("brand_id, preset_id, position")
        .in("brand_id", ids)
        .order("brand_id", { ascending: true })
        .order("preset_id", { ascending: true })
        .order("position", { ascending: true })
        .range(from, to),
    "brand_faq_entries",
  );

  const products = await selectAllPages<ProductRow & { brand_id: string }>(
    (from, to) =>
      client
        .from("curated_products")
        .select(
          "brand_id, visible, link_state, link_checked_at, made_in_taiwan_confirmed, image_url",
        )
        .in("brand_id", ids)
        .order("id", { ascending: true })
        .range(from, to),
    "curated_products",
  );

  // Pending refresh submissions for this cohort's brands
  const pendingSubmissions = await selectAllPages<{
    id: string;
    brand_id: string;
    enriched_data: { products?: unknown[] } | null;
  }>(
    (from, to) =>
      client
        .from("brand_submissions")
        .select("id, brand_id, enriched_data")
        .in("brand_id", ids)
        .eq("intent", "refresh")
        .eq("status", "pending")
        .order("id", { ascending: true })
        .range(from, to),
    "submissions (pending refresh)",
  );

  const pendingSubmissionIds = pendingSubmissions.map((sub) => sub.id);

  const submissionImages =
    pendingSubmissionIds.length > 0
      ? await selectAllPages<{
          submission_id: string;
          status: string;
        }>(
          (from, to) =>
            client
              .from("submission_images")
              .select("submission_id, status")
              .in("submission_id", pendingSubmissionIds)
              .order("id", { ascending: true })
              .range(from, to),
          "submission_images",
        )
      : [];

  const candidateProducts =
    pendingSubmissionIds.length > 0
      ? await selectAllPages<{
          submission_id: string;
        }>(
          (from, to) =>
            client
              .from("curated_product_candidates")
              .select("submission_id")
              .in("submission_id", pendingSubmissionIds)
              .not("final_rank", "is", null)
              .order("id", { ascending: true })
              .range(from, to),
          "curated_product_candidates",
        )
      : [];

  // Denied submissions, any intent — the channel verdict denies a submission
  // instead of hiding a brand when there is no brand row yet.
  const deniedSubmissions = await selectAllPages<{
    brand_id: string;
    denial_reason: string | null;
    reviewed_at: string | null;
    submitted_at: string | null;
  }>(
    (from, to) =>
      client
        .from("brand_submissions")
        .select("brand_id, denial_reason, reviewed_at, submitted_at")
        .in("brand_id", ids)
        .not("denial_reason", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    "submissions (denied)",
  );

  const denialReasonByBrand = new Map<
    string,
    { reason: string | null; at: string }
  >();
  for (const row of deniedSubmissions) {
    const at = row.reviewed_at ?? row.submitted_at ?? "";
    const seen = denialReasonByBrand.get(row.brand_id);
    if (!seen || at >= seen.at) {
      denialReasonByBrand.set(row.brand_id, { reason: row.denial_reason, at });
    }
  }

  // Latest curation target per slug — the acquire phase of that run is what
  // produced the link columns above.
  const curationTargets = await selectAllPages<{
    brand_slug: string | null;
    created_at: string;
    phase_results: Json;
  }>(
    (from, to) =>
      client
        .from("curation_job_targets")
        .select("brand_slug, created_at, phase_results")
        .in("brand_slug", slugs)
        .order("id", { ascending: true })
        .range(from, to),
    "curation_job_targets",
  );

  const linkSourcesBySlug = new Map<string, { sources: string; at: string }>();
  for (const target of curationTargets) {
    if (!target.brand_slug) continue;
    const seen = linkSourcesBySlug.get(target.brand_slug);
    if (seen && target.created_at < seen.at) continue;
    linkSourcesBySlug.set(target.brand_slug, {
      sources: linkSourcesFromPhaseResults(
        parsePhaseResults(target.phase_results),
      ),
      at: target.created_at,
    });
  }

  const submissionsByBrand = groupBy(pendingSubmissions, (row) => row.brand_id);
  const submissionImagesBySubmission = groupBy(
    submissionImages,
    (row) => row.submission_id,
  );
  const candidateProductsBySubmission = groupBy(
    candidateProducts,
    (row) => row.submission_id,
  );

  const imagesByBrand = groupBy(images, (row) => row.brand_id);
  const channelsByBrand = groupBy(channels, (row) => row.brand_id);
  const faqsByBrand = groupBy(faqs, (row) => row.brand_id);
  const productsByBrand = groupBy(products, (row) => row.brand_id);

  return brandRows.map((brand) => {
    const brandImages = imagesByBrand.get(brand.id) ?? [];
    const productTotals = summarizeProductRows(
      productsByBrand.get(brand.id) ?? [],
    );
    // `brand_images` owns the ordering; `brands.hero_image_storage_path` is its
    // denormalized projection and can lag, so the row is preferred.
    const heroPath =
      brandImages.find((image) => image.sort_order === 0)?.storage_path ??
      brand.hero_image_storage_path;

    return {
      slug: brand.slug,
      name: brand.name,
      status: brand.status,
      hidden_reason: brand.hidden_reason,
      submission_denial_reason:
        denialReasonByBrand.get(brand.id)?.reason ?? null,
      link_sources: linkSourcesBySlug.get(brand.slug)?.sources ?? "",
      purchase_website: brand.purchase_website,
      social_instagram: brand.social_instagram,
      social_threads: brand.social_threads,
      social_facebook: brand.social_facebook,
      description: textStat(brand.description, "zh"),
      description_en: textStat(brand.description_en, "en"),
      blurb: textStat(brand.blurb, "zh"),
      blurb_en: textStat(brand.blurb_en, "en"),
      active_image_count: brandImages.length,
      hero_storage_path: heroPath,
      gallery_count: countGallery(brandImages),
      stockists_count: (channelsByBrand.get(brand.id) ?? []).filter(
        (row) => row.removed_at === null,
      ).length,
      faq_count: (faqsByBrand.get(brand.id) ?? []).length,
      visible_products: productTotals.visible,
      products_link_checked: productTotals.linkChecked,
      products_mit_confirmed: productTotals.mitConfirmed,
      products_with_image: productTotals.withImage,
      ...pendingFieldsForBrand(
        brand.id,
        submissionsByBrand,
        submissionImagesBySubmission,
        candidateProductsBySubmission,
      ),
    };
  });
}

/** Aggregate pending submission stats for a single brand. */
function pendingFieldsForBrand(
  brandId: string,
  submissionsByBrand: Map<
    string,
    { id: string; enriched_data: { products?: unknown[] } | null }[]
  >,
  submissionImagesBySubmission: Map<string, { status: string }[]>,
  candidateProductsBySubmission: Map<string, unknown[]>,
): Pick<
  CensusRow,
  | "pending_products"
  | "pending_candidate_rank_count"
  | "pending_active_images"
  | "pending_candidate_images"
> {
  const subs = submissionsByBrand.get(brandId) ?? [];
  if (subs.length === 0) {
    return {
      pending_products: 0,
      pending_candidate_rank_count: 0,
      pending_active_images: 0,
      pending_candidate_images: 0,
    };
  }

  let pendingProducts = 0;
  let pendingCandidateRankCount = 0;
  let pendingActiveImages = 0;
  let pendingCandidateImages = 0;

  for (const sub of subs) {
    pendingProducts += sub.enriched_data?.products?.length ?? 0;
    pendingCandidateRankCount +=
      (candidateProductsBySubmission.get(sub.id) ?? []).length;
    const imgs = submissionImagesBySubmission.get(sub.id) ?? [];
    pendingActiveImages += imgs.filter((img) => img.status === "active").length;
    pendingCandidateImages += imgs.filter(
      (img) => img.status === "candidate",
    ).length;
  }

  return {
    pending_products: pendingProducts,
    pending_candidate_rank_count: pendingCandidateRankCount,
    pending_active_images: pendingActiveImages,
    pending_candidate_images: pendingCandidateImages,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function argValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv.at(index + 1);
}

async function readCensusFile(path: string): Promise<CensusFile> {
  const parsed = JSON.parse(await readFile(resolve(path), "utf8")) as CensusFile;
  if (!Array.isArray(parsed.rows)) {
    throw new Error(`${path} is not a census file (no rows array)`);
  }
  return parsed;
}

async function runDiff(argv: readonly string[]): Promise<void> {
  const index = argv.indexOf("--diff");
  const beforePath = argv.at(index + 1);
  const afterPath = argv.at(index + 2);
  if (!beforePath || !afterPath) {
    throw new Error("Usage: --diff <before.json> <after.json>");
  }

  const [before, after] = await Promise.all([
    readCensusFile(beforePath),
    readCensusFile(afterPath),
  ]);
  console.log(renderCensusDiff(before, after));
}

async function runCensus(
  argv: readonly string[],
  target: string,
): Promise<void> {
  const slugsArg = argValue(argv, "--slugs");
  const cohortName = argValue(argv, "--cohort");
  if (!slugsArg && !cohortName) {
    throw new Error("Usage: --cohort <name> | --slugs a,b,c [--out file.json]");
  }

  const cohort = cohortName ? await loadCohort() : null;
  const slugs = cohort
    ? cohort.slugs
    : (slugsArg ?? "")
        .split(",")
        .map((slug) => slug.trim())
        .filter((slug) => slug.length > 0);
  if (slugs.length === 0) throw new Error("no slugs to census");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env",
    );
  }

  assertCensusTarget({
    supabaseUrl,
    target,
    confirmed: argv.includes("--confirm"),
  });

  const { client, blocked } = createWriteBlockingClient(
    supabaseUrl,
    supabaseKey,
  );

  console.log(`[census] reading ${slugs.length} brands…`);
  const rows = await fetchCensus(client, slugs);

  const missing = slugs.filter((slug) => !rows.some((row) => row.slug === slug));
  if (missing.length > 0) {
    console.warn(`[census] ${missing.length} slug(s) not found: ${missing.join(", ")}`);
  }

  const file: CensusFile = {
    cohort: cohort?.name ?? "adhoc",
    capturedAt: new Date().toISOString(),
    rows: rows.sort((a, b) => a.slug.localeCompare(b.slug)),
  };

  const outPath = argValue(argv, "--out");
  if (outPath) {
    const resolved = resolve(outPath);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, JSON.stringify(file, null, 2) + "\n");
    console.log(`[census] wrote ${resolved}`);
  } else {
    console.log(JSON.stringify(file, null, 2));
  }

  if (blocked.length > 0) {
    console.warn(`[census] ${blocked.length} blocked writes (should be 0):`);
    for (const write of blocked) {
      console.warn(`  ${write.table}.${write.method}`);
    }
  }
}

async function fetchSubmissionCensus(
  client: SupabaseLike,
  submissionIds: string[],
): Promise<SubmissionCensusRow[]> {
  const submissions = await selectAllPages<{
    id: string;
    brand_id: string | null;
    denial_reason: string | null;
    enriched_data: { products?: unknown[] } | null;
  }>(
    (from, to) =>
      client
        .from("brand_submissions")
        .select("id, brand_id, denial_reason, enriched_data")
        .in("id", submissionIds)
        .order("id", { ascending: true })
        .range(from, to),
    "submissions (by id)",
  );

  const ids = submissions.map((sub) => sub.id);
  if (ids.length === 0) return [];

  const submissionImages = await selectAllPages<{
    submission_id: string;
    status: string;
  }>(
    (from, to) =>
      client
        .from("submission_images")
        .select("submission_id, status")
        .in("submission_id", ids)
        .order("id", { ascending: true })
        .range(from, to),
    "submission_images",
  );

  const candidateProducts = await selectAllPages<{
    submission_id: string;
  }>(
    (from, to) =>
      client
        .from("curated_product_candidates")
        .select("submission_id")
        .in("submission_id", ids)
        .not("final_rank", "is", null)
        .order("id", { ascending: true })
        .range(from, to),
    "curated_product_candidates",
  );

  const imagesBySubmission = groupBy(
    submissionImages,
    (row) => row.submission_id,
  );
  const candidatesBySubmission = groupBy(
    candidateProducts,
    (row) => row.submission_id,
  );

  return submissions
    .filter((sub) => sub.brand_id === null)
    .map((sub) => {
      const imgs = imagesBySubmission.get(sub.id) ?? [];
      return {
        submission_id: sub.id,
        slug: null,
        submission_denial_reason: sub.denial_reason,
        pending_products: sub.enriched_data?.products?.length ?? 0,
        pending_candidate_rank_count:
          (candidatesBySubmission.get(sub.id) ?? []).length,
        pending_active_images: imgs.filter((img) => img.status === "active")
          .length,
        pending_candidate_images: imgs.filter(
          (img) => img.status === "candidate",
        ).length,
      };
    });
}

async function runSubmissionCensus(
  argv: readonly string[],
  target: string,
): Promise<void> {
  const idsArg = argValue(argv, "--submission-ids");
  if (!idsArg) throw new Error("--submission-ids is required");

  const submissionIds = idsArg
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  if (submissionIds.length === 0) throw new Error("no submission ids to census");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env",
    );
  }

  assertCensusTarget({
    supabaseUrl,
    target,
    confirmed: argv.includes("--confirm"),
  });

  const { client, blocked } = createWriteBlockingClient(
    supabaseUrl,
    supabaseKey,
  );

  console.log(
    `[census] reading ${submissionIds.length} submission(s)…`,
  );
  const rows = await fetchSubmissionCensus(client, submissionIds);

  const outPath = argValue(argv, "--out");
  const output = JSON.stringify(
    { capturedAt: new Date().toISOString(), rows },
    null,
    2,
  );
  if (outPath) {
    const resolved = resolve(outPath);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, output + "\n");
    console.log(`[census] wrote ${resolved}`);
  } else {
    console.log(output);
  }

  if (blocked.length > 0) {
    console.warn(`[census] ${blocked.length} blocked writes (should be 0):`);
    for (const write of blocked) {
      console.warn(`  ${write.table}.${write.method}`);
    }
  }
}

async function main(): Promise<void> {
  // The diff reads two local files and touches no database, so it must not
  // demand credentials for a project it never opens.
  if (process.argv.slice(2).includes("--diff")) {
    await runDiff(process.argv.slice(2));
    return;
  }

  const { argv, target } = loadScriptTarget();

  if (argv.includes("--submission-ids")) {
    await runSubmissionCensus(argv, target);
    return;
  }

  await runCensus(argv, target);
}

if (process.env.VITEST !== "true") {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
