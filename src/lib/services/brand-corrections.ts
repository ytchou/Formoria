import { revalidatePublicBrand } from "@/lib/cache/public-brand-cache";
import {
  normalizeTagKey,
  PRODUCT_TYPE_CATEGORIES,
} from "@/lib/taxonomy/ontology";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/server";
import {
  applyTagDelta,
  deriveProductTagsEn,
  isProductTagsDelta,
  MAX_PRODUCT_TAGS,
  resolveProductTagInput,
  sameTagSet,
  type ProductTagsDelta,
} from "./product-tags";
import { updateBrand, type BrandWriteInput } from "./brands";

const CORRECTION_SELECT =
  "*, brands(name, slug, price_range, product_type, product_tags)";

const PRODUCT_TYPE_SLUGS = new Set<string>(
  PRODUCT_TYPE_CATEGORIES.map((category) => category.slug),
);
type BrandCorrectionRow =
  Database["public"]["Tables"]["brand_field_corrections"]["Row"];
type BrandCorrectionInsert =
  Database["public"]["Tables"]["brand_field_corrections"]["Insert"];
type BrandCorrectionBrandRow = Pick<
  Database["public"]["Tables"]["brands"]["Row"],
  "id" | "name" | "slug" | "price_range" | "product_type" | "product_tags"
>;
type BrandCorrectionRowWithBrand = BrandCorrectionRow & {
  brands?: BrandCorrectionBrandRow | null;
};

export type CorrectionField = "price_range" | "product_type" | "product_tags";
type CorrectionStatus = "pending" | "approved" | "rejected";
export type CorrectionDecision = Exclude<CorrectionStatus, "pending">;

type CorrectionProposedValue = number | string | ProductTagsDelta;

export type BrandCorrection = {
  id: string;
  brandId: string;
  field: CorrectionField;
  proposedValue: CorrectionProposedValue;
  previousValue: Json | null;
  currentValue: CurrentBrandValue;
  visitorHash: string | null;
  status: CorrectionStatus;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewerNotes: string | null;
  createdAt: string;
  brandName: string | null;
  brandSlug: string | null;
  stale: boolean;
};

export type SubmitCorrectionInput = {
  brandId: string;
  field: string;
  proposedValue: unknown;
  visitorHash?: string | null;
};

export type SubmitCorrectionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      code:
        | "invalid_field"
        | "invalid_value"
        | "unchanged"
        | "too_many_tags"
        | "already_submitted"
        | "not_found"
        | "database_error";
    };

export type ListCorrectionsOptions = {
  status?: CorrectionStatus;
  limit?: number;
  offset?: number;
};

export type ReviewCorrectionResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "invalid_value"
        | "too_many_tags"
        | "not_found"
        | "already_reviewed"
        | "database_error";
    };

type CorrectionError = Extract<SubmitCorrectionResult, { ok: false }>["code"];
type CurrentBrandValue = number | string | string[] | null;

function isCorrectionField(value: string): value is CorrectionField {
  return (
    value === "price_range" ||
    value === "product_type" ||
    value === "product_tags"
  );
}

export type NormalizeProposedValueResult =
  | { ok: true; value: CorrectionProposedValue }
  | { ok: false; error: Extract<CorrectionError, "invalid_value"> };

/**
 * Validates AND canonicalizes a proposed value. The result is what gets
 * persisted at submit, and the same function re-runs over the stored value at
 * approval — so it must be idempotent: `normalize(normalize(x).value)` has to
 * deep-equal `normalize(x).value`, or a correction that passes at submit would
 * fail at approval. `src/lib/services/__tests__/brand-corrections.test.ts` pins
 * that directly.
 *
 * Idempotency holds against a FIXED ontology only. Two drift directions across
 * ontology EDITS are known and accepted:
 *
 * 1. Removal: reviewCorrection runs this guard BEFORE its rejection branch, so
 *    if a `nameZh` is later dropped from the ontology a stale pending row can
 *    become both un-approvable and un-rejectable. Pre-existing, not introduced
 *    here.
 * 2. Add-as-alias: a novel tag is persisted raw and the admin queue renders that
 *    stored string. If that exact string is later added to the ontology as an
 *    ALIAS of a subcategory, the approval-time re-normalization rewrites `add`
 *    to that subcategory's `nameZh` — so the reviewer approves a label they
 *    never saw. Deliberately not snapshotted or versioned: an alias is by
 *    definition a synonym of what was on screen, so the substitution preserves
 *    meaning and the added machinery would not earn its cost.
 */
export function normalizeProposedValue(
  field: CorrectionField,
  value: unknown,
): NormalizeProposedValueResult {
  if (field === "price_range") {
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 3
      ? { ok: true, value }
      : { ok: false, error: "invalid_value" };
  }

  if (field === "product_type") {
    return typeof value === "string" && PRODUCT_TYPE_SLUGS.has(value)
      ? { ok: true, value }
      : { ok: false, error: "invalid_value" };
  }

  if (!isProductTagsDelta(value)) return { ok: false, error: "invalid_value" };

  // Asymmetric on purpose. Every `add` is canonicalized through the ontology
  // (alias or English name -> `nameZh`) before it is persisted: brands.product_tags
  // stores canonical labels and the `?sub=` filter matches by exact-string array
  // overlap, so an un-canonicalized addition would silently drop the brand from
  // subcategory results. A tag the ontology does not know is still allowed
  // through — that escape hatch is the point — but only if it clears the same
  // novel-tag heuristics enrichment applies. `remove` stays unrestricted: a brand
  // can carry novel tags persisted by normalizeProductTags, and removing a bad
  // value can never introduce one. Rejecting those removals would block exactly
  // the repair this feature exists to perform.
  // Ceiling: `novelTagRejection` is a code-point length band plus a
  // marketing-noise regex whose terms are all Han — so non-CJK input passes
  // with NO content filter at all, and admin review is the only gate on it;
  // swap for a language-agnostic blocklist (or a moderation call) if reviewers
  // report abusive submissions.
  // Dedupe on the ontology's matching key, not the raw string: novel tags are
  // stored as typed, so 'Vegan' and 'vegan' would otherwise both survive and
  // take two of the five cap slots. First-seen casing wins.
  const add: string[] = [];
  const seenAdd = new Set<string>();
  for (const raw of value.add) {
    const resolved = resolveProductTagInput(raw);
    if (!resolved.ok) return { ok: false, error: "invalid_value" };
    const key = normalizeTagKey(resolved.tag);
    if (seenAdd.has(key)) continue;
    seenAdd.add(key);
    add.push(resolved.tag);
  }

  const remove: string[] = [];
  const seenRemove = new Set<string>();
  for (const raw of value.remove) {
    const trimmed = raw.trim();
    if (!trimmed || seenRemove.has(trimmed)) continue;
    seenRemove.add(trimmed);
    remove.push(trimmed);
  }

  return { ok: true, value: { add, remove } };
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((value, index) => valuesEqual(value, right[index]));
  }

  if (
    typeof left === "object" &&
    left !== null &&
    typeof right === "object" &&
    right !== null
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(
      (key) =>
        key in rightRecord && valuesEqual(leftRecord[key], rightRecord[key]),
    );
  }

  return left === right;
}

function currentValueForField(
  field: CorrectionField,
  brand: BrandCorrectionBrandRow | null | undefined,
): CurrentBrandValue {
  if (!brand) return null;
  if (field === "price_range") return brand.price_range;
  if (field === "product_type") return brand.product_type;
  return Array.isArray(brand.product_tags) ? brand.product_tags : [];
}

function rowToCorrection(row: BrandCorrectionRowWithBrand): BrandCorrection {
  const field = row.field as CorrectionField;
  const currentValue = currentValueForField(field, row.brands);

  return {
    id: row.id,
    brandId: row.brand_id,
    field,
    proposedValue: row.proposed_value as CorrectionProposedValue,
    previousValue: row.previous_value,
    currentValue,
    visitorHash: row.visitor_hash,
    status: row.status as CorrectionStatus,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    reviewerNotes: row.reviewer_notes,
    createdAt: row.created_at,
    brandName: row.brands?.name ?? null,
    brandSlug: row.brands?.slug ?? null,
    stale: !valuesEqual(currentValue, row.previous_value),
  };
}

function dbErrorCode(
  error: { code?: string } | null,
): "already_submitted" | "database_error" {
  return error?.code === "23505" ? "already_submitted" : "database_error";
}

async function readBrand(
  supabase: ReturnType<typeof createServiceClient>,
  brandId: string,
): Promise<{
  data: BrandCorrectionBrandRow | null;
  error: { code?: string } | null;
}> {
  // Scoped to approved like every other public read path. This runs on the
  // RLS-bypassing service client behind an unauthenticated action, and brand
  // UUIDs are in the public RSC payload — without this filter the distinct
  // result codes let an anonymous caller probe the existence and field values
  // of brands that are not publicly listed.
  const { data, error } = await supabase
    .from("brands")
    .select("id, name, slug, price_range, product_type, product_tags")
    .eq("id", brandId)
    .eq("status", "approved")
    .maybeSingle();

  return {
    data: data as BrandCorrectionBrandRow | null,
    error,
  };
}

/**
 * Claims a pending correction for one reviewer. The `status = 'pending'` guard
 * plus the exact row count make this the concurrency token: the guarding SELECT
 * is a separate round-trip, so two admin tabs can both see `pending`, and only
 * the tab whose UPDATE touches a row may go on to write the brand.
 */
async function markReviewed(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
  decision: CorrectionDecision,
  notes: string,
  reviewerId: string,
  reviewedAt: string,
): Promise<
  { ok: true } | { ok: false; code: "database_error" | "already_reviewed" }
> {
  const { error, count } = await supabase
    .from("brand_field_corrections")
    .update(
      {
        status: decision,
        reviewed_at: reviewedAt,
        reviewed_by: reviewerId,
        reviewer_notes: notes,
      },
      { count: "exact" },
    )
    .eq("id", id)
    .eq("status", "pending");

  if (error) return { ok: false, code: "database_error" };
  if (count === 0) return { ok: false, code: "already_reviewed" };
  return { ok: true };
}

/**
 * Compensating write for a claim whose brand update then failed — puts the row
 * back in the queue so a transient database error cannot silently drop a
 * correction. Best effort: if this write fails too, the row stays reviewed and
 * the reviewer already has the error result.
 */
async function releaseClaim(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
): Promise<void> {
  await supabase
    .from("brand_field_corrections")
    .update({
      status: "pending",
      reviewed_at: null,
      reviewed_by: null,
      reviewer_notes: null,
    })
    .eq("id", id);
}

async function supersedePendingTags(
  supabase: ReturnType<typeof createServiceClient>,
  brandId: string,
  reviewerId: string,
  reviewedAt: string,
): Promise<{ ok: true } | { ok: false; code: "database_error" }> {
  const { error } = await supabase
    .from("brand_field_corrections")
    .update({
      status: "rejected",
      reviewed_at: reviewedAt,
      reviewed_by: reviewerId,
      reviewer_notes: "superseded_by_category_change",
    })
    .eq("brand_id", brandId)
    .eq("field", "product_tags")
    .eq("status", "pending");

  if (error) return { ok: false, code: "database_error" };
  return { ok: true };
}

export async function submitCorrection(
  input: SubmitCorrectionInput,
): Promise<SubmitCorrectionResult> {
  if (!isCorrectionField(input.field))
    return { ok: false, code: "invalid_field" };

  const normalized = normalizeProposedValue(input.field, input.proposedValue);
  if (!normalized.ok) return { ok: false, code: normalized.error };
  // Everything downstream — the delta application, the cap check and the row we
  // persist — reads the normalized value, never `input.proposedValue`.
  const proposedValue = normalized.value;

  try {
    const supabase = createServiceClient();
    const { data: brand, error: brandError } = await readBrand(
      supabase,
      input.brandId,
    );
    if (brandError) return { ok: false, code: "database_error" };
    if (!brand) return { ok: false, code: "not_found" };

    const currentValue = currentValueForField(input.field, brand);
    let previousValue: Json | null = currentValue;

    if (input.field === "product_tags") {
      const delta = proposedValue as ProductTagsDelta;
      const currentTags = Array.isArray(currentValue) ? currentValue : [];
      const next = applyTagDelta(currentTags, delta);
      if (sameTagSet(currentTags, next))
        return { ok: false, code: "unchanged" };
      if (next.length > MAX_PRODUCT_TAGS) {
        return { ok: false, code: "too_many_tags" };
      }
      previousValue = currentTags;
    } else if (valuesEqual(currentValue, proposedValue)) {
      return { ok: false, code: "unchanged" };
    }

    const row: BrandCorrectionInsert = {
      brand_id: input.brandId,
      field: input.field,
      proposed_value: proposedValue as Json,
      previous_value: previousValue,
      visitor_hash: input.visitorHash ?? null,
      status: "pending",
    };
    const { data, error } = await supabase
      .from("brand_field_corrections")
      .insert(row)
      .select("id")
      .single();

    if (error) return { ok: false, code: dbErrorCode(error) };
    if (!data || typeof data.id !== "string") {
      return { ok: false, code: "database_error" };
    }
    return { ok: true, id: data.id };
  } catch {
    return { ok: false, code: "database_error" };
  }
}

export async function listCorrections(
  opts: ListCorrectionsOptions = {},
): Promise<BrandCorrection[]> {
  const supabase = createServiceClient();
  let query = supabase
    .from("brand_field_corrections")
    .select(CORRECTION_SELECT)
    .order("created_at", { ascending: false });

  if (opts.status) query = query.eq("status", opts.status);
  if (opts.limit !== undefined) {
    const limit = Math.min(Math.max(1, Math.floor(opts.limit)), 100);
    const offset = Math.max(0, Math.floor(opts.offset ?? 0));
    query = query.range(offset, offset + limit - 1);
  }

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as unknown as BrandCorrectionRowWithBrand[]).map(
    rowToCorrection,
  );
}

export async function reviewCorrection(
  id: string,
  decision: CorrectionDecision,
  notes: string,
  { reviewerId }: { reviewerId: string },
): Promise<ReviewCorrectionResult> {
  if (decision !== "approved" && decision !== "rejected") {
    return { ok: false, code: "database_error" };
  }

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("brand_field_corrections")
      .select(CORRECTION_SELECT)
      .eq("id", id)
      .eq("status", "pending")
      .maybeSingle();

    if (error) return { ok: false, code: "database_error" };
    if (!data) return { ok: false, code: "not_found" };

    const row = data as unknown as BrandCorrectionRowWithBrand;
    if (!isCorrectionField(row.field) || !row.brands) {
      return { ok: false, code: "invalid_value" };
    }

    // Re-normalizes an already-normalized stored value; idempotency is what
    // keeps a row that passed at submit from failing here.
    const normalized = normalizeProposedValue(row.field, row.proposed_value);
    if (!normalized.ok) return { ok: false, code: normalized.error };
    const proposedValue = normalized.value;

    const reviewedAt = new Date().toISOString();
    if (decision === "rejected") {
      return markReviewed(
        supabase,
        id,
        decision,
        notes,
        reviewerId,
        reviewedAt,
      );
    }

    const currentValue = currentValueForField(row.field, row.brands);
    // `null` means the brand already holds the proposed value. The dedup index
    // is per visitor_hash, so N visitors reporting the same wrong value each
    // create a row; approving the first applies it and every later row is a
    // no-op. Those are still correct suggestions — approve them and let them
    // leave the queue instead of stranding them as un-approvable pending rows.
    let patch: BrandWriteInput | null;

    if (row.field === "product_tags") {
      const delta = proposedValue as ProductTagsDelta;
      const currentTags = Array.isArray(currentValue) ? currentValue : [];
      const next = applyTagDelta(currentTags, delta);
      if (sameTagSet(currentTags, next)) {
        patch = null;
      } else if (next.length > MAX_PRODUCT_TAGS) {
        return { ok: false, code: "too_many_tags" };
      } else {
        patch = {
          productTags: next,
          productTagsEn: deriveProductTagsEn(next),
        };
      }
    } else if (valuesEqual(currentValue, proposedValue)) {
      patch = null;
    } else {
      patch =
        row.field === "price_range"
          ? { priceRange: proposedValue as number }
          : { productType: proposedValue as string };
    }

    // Claim before writing the brand: losing the race here means another
    // reviewer already applied this decision, and re-running updateBrand would
    // append a second brand_field_events row for one human decision.
    const claimed = await markReviewed(
      supabase,
      id,
      decision,
      notes,
      reviewerId,
      reviewedAt,
    );
    if (!claimed.ok) return claimed;

    if (patch) {
      try {
        await updateBrand(row.brand_id, patch, {
          source: "admin",
          userId: reviewerId,
        });
      } catch (writeError) {
        await releaseClaim(supabase, id);
        throw writeError;
      }
    }

    const superseded =
      row.field === "product_type"
        ? await supersedePendingTags(
            supabase,
            row.brand_id,
            reviewerId,
            reviewedAt,
          )
        : { ok: true as const };

    // Cache invalidation follows the data write, never the happy path: a failed
    // supersede must not leave the public ISR pages serving the old value for
    // up to an hour with no way to trigger revalidation.
    revalidatePublicBrand({ slug: row.brands.slug });
    if (!superseded.ok) return superseded;
    return { ok: true };
  } catch {
    return { ok: false, code: "database_error" };
  }
}
