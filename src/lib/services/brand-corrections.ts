import { revalidatePublicBrand } from "@/lib/cache/public-brand-cache";
import {
  PRODUCT_SUBCATEGORIES,
  PRODUCT_TYPE_CATEGORIES,
} from "@/lib/taxonomy/ontology";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/server";
import { deriveProductTagsEn, MAX_PRODUCT_TAGS } from "./product-tags";
import { updateBrand } from "./brands";

const CORRECTION_SELECT =
  "*, brands(name, slug, price_range, product_type, product_tags)";

const PRODUCT_TYPE_SLUGS = new Set<string>(
  PRODUCT_TYPE_CATEGORIES.map((category) => category.slug),
);
const PRODUCT_TAG_NAMES_ZH = new Set(
  PRODUCT_SUBCATEGORIES.map((subcategory) => subcategory.nameZh),
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
export type CorrectionStatus = "pending" | "approved" | "rejected";
export type CorrectionDecision = Exclude<CorrectionStatus, "pending">;

export type ProductTagsDelta = {
  add: string[];
  remove: string[];
};

export type CorrectionProposedValue = number | string | ProductTagsDelta;

export type BrandCorrection = {
  id: string;
  brandId: string;
  field: CorrectionField;
  proposedValue: CorrectionProposedValue;
  previousValue: Json | null;
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
        | "unchanged"
        | "too_many_tags"
        | "not_found"
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

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isProductTagsDelta(value: unknown): value is ProductTagsDelta {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  return isStringArray(record.add) && isStringArray(record.remove);
}

function validateProposedValue(
  field: CorrectionField,
  value: unknown,
): Extract<CorrectionError, "invalid_value"> | null {
  if (field === "price_range") {
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 3
      ? null
      : "invalid_value";
  }

  if (field === "product_type") {
    return typeof value === "string" && PRODUCT_TYPE_SLUGS.has(value)
      ? null
      : "invalid_value";
  }

  if (!isProductTagsDelta(value)) return "invalid_value";
  if (
    [...value.add, ...value.remove].some(
      (tag) => !PRODUCT_TAG_NAMES_ZH.has(tag),
    )
  ) {
    return "invalid_value";
  }
  return null;
}

export function applyTagDelta(
  current: string[],
  delta: ProductTagsDelta,
): string[] {
  const removed = new Set(delta.remove);
  const seen = new Set<string>();
  const next: string[] = [];

  for (const tag of current) {
    if (removed.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    next.push(tag);
  }

  for (const tag of delta.add) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    next.push(tag);
  }

  return next;
}

function sameTagSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((tag) => rightSet.has(tag));
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
  const { data, error } = await supabase
    .from("brands")
    .select("id, name, slug, price_range, product_type, product_tags")
    .eq("id", brandId)
    .maybeSingle();

  return {
    data: data as BrandCorrectionBrandRow | null,
    error,
  };
}

async function markReviewed(
  supabase: ReturnType<typeof createServiceClient>,
  id: string,
  decision: CorrectionDecision,
  notes: string,
  reviewerId: string,
  reviewedAt: string,
): Promise<{ ok: true } | { ok: false; code: "database_error" }> {
  const { error } = await supabase
    .from("brand_field_corrections")
    .update({
      status: decision,
      reviewed_at: reviewedAt,
      reviewed_by: reviewerId,
      reviewer_notes: notes,
    })
    .eq("id", id)
    .eq("status", "pending");

  if (error) return { ok: false, code: "database_error" };
  return { ok: true };
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

  const validationError = validateProposedValue(
    input.field,
    input.proposedValue,
  );
  if (validationError) return { ok: false, code: validationError };

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
      const delta = input.proposedValue as ProductTagsDelta;
      const currentTags = Array.isArray(currentValue) ? currentValue : [];
      const next = applyTagDelta(currentTags, delta);
      if (sameTagSet(currentTags, next))
        return { ok: false, code: "unchanged" };
      if (next.length > MAX_PRODUCT_TAGS) {
        return { ok: false, code: "too_many_tags" };
      }
      previousValue = currentTags;
    } else if (valuesEqual(currentValue, input.proposedValue)) {
      return { ok: false, code: "unchanged" };
    }

    const row: BrandCorrectionInsert = {
      brand_id: input.brandId,
      field: input.field,
      proposed_value: input.proposedValue as Json,
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

    const validationError = validateProposedValue(
      row.field,
      row.proposed_value,
    );
    if (validationError) return { ok: false, code: validationError };

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
    let patch: Record<string, unknown>;

    if (row.field === "product_tags") {
      const delta = row.proposed_value as ProductTagsDelta;
      const currentTags = Array.isArray(currentValue) ? currentValue : [];
      const next = applyTagDelta(currentTags, delta);
      if (sameTagSet(currentTags, next))
        return { ok: false, code: "unchanged" };
      if (next.length > MAX_PRODUCT_TAGS) {
        return { ok: false, code: "too_many_tags" };
      }
      patch = {
        productTags: next,
        productTagsEn: deriveProductTagsEn(next),
      };
    } else {
      if (valuesEqual(currentValue, row.proposed_value)) {
        return { ok: false, code: "unchanged" };
      }
      patch =
        row.field === "price_range"
          ? { priceRange: row.proposed_value }
          : { productType: row.proposed_value };
    }

    await updateBrand(row.brand_id, patch, {
      source: "admin",
      userId: reviewerId,
    });

    const reviewed = await markReviewed(
      supabase,
      id,
      decision,
      notes,
      reviewerId,
      reviewedAt,
    );
    if (!reviewed.ok) return reviewed;

    if (row.field === "product_type") {
      const superseded = await supersedePendingTags(
        supabase,
        row.brand_id,
        reviewerId,
        reviewedAt,
      );
      if (!superseded.ok) return superseded;
    }

    revalidatePublicBrand({ slug: row.brands.slug });
    return { ok: true };
  } catch {
    return { ok: false, code: "database_error" };
  }
}
