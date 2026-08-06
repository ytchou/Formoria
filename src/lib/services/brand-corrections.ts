import { revalidatePublicBrand } from "@/lib/cache/public-brand-cache";
import {
  isPrivateUrl,
  normalizeInstagramHref,
  normalizeThreadsHref,
  sanitizeHref,
} from "@/lib/url";
import {
  normalizeTagKey,
  PRODUCT_TYPE_CATEGORIES,
} from "@/lib/taxonomy/ontology";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/server";
import { auditedCall } from "@/lib/audit";
import { isUuid, validateIdBatch } from "@/lib/validation/id-batch";
import {
  PURCHASE_CHANNELS,
  PURCHASE_COLUMNS,
  purchaseChannelByColumn,
  type PurchaseChannelCamelField,
  type PurchaseChannelColumn,
} from "@/lib/brands/purchase-channels";
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
  `*, brands(name, slug, price_range, product_type, product_tags, ${PURCHASE_COLUMNS.join(
    ", ",
  )}, social_instagram, social_threads, social_facebook)`;

const MAX_LINK_URL_LENGTH = 2048;
const SOCIAL_LINK_FIELDS = [
  "social_instagram",
  "social_threads",
  "social_facebook",
] as const;

const PRODUCT_TYPE_SLUGS = new Set<string>(
  PRODUCT_TYPE_CATEGORIES.map((category) => category.slug),
);
type BrandCorrectionRow =
  Database["public"]["Tables"]["brand_field_corrections"]["Row"];
type BrandCorrectionInsert =
  Database["public"]["Tables"]["brand_field_corrections"]["Insert"];
type BrandCorrectionBrandRow = Pick<
  Database["public"]["Tables"]["brands"]["Row"],
  | "id"
  | "name"
  | "slug"
  | "price_range"
  | "product_type"
  | "product_tags"
  | "social_instagram"
  | "social_threads"
  | "social_facebook"
>;
type BrandCorrectionBrandPurchaseFields = Pick<
  Database["public"]["Tables"]["brands"]["Row"] & {
    [Column in PurchaseChannelColumn]?: string | null;
  },
  PurchaseChannelColumn
>;
type BrandCorrectionBrand = BrandCorrectionBrandRow &
  BrandCorrectionBrandPurchaseFields;
type BrandCorrectionRowWithBrand = BrandCorrectionRow & {
  brands?: BrandCorrectionBrand | null;
};

type PurchaseLinkCorrectionField = PurchaseChannelColumn;
type SocialLinkCorrectionField = (typeof SOCIAL_LINK_FIELDS)[number];
type LinkCorrectionField =
  | PurchaseLinkCorrectionField
  | SocialLinkCorrectionField;
export type CorrectionField =
  | "price_range"
  | "product_type"
  | "product_tags"
  | LinkCorrectionField;
type ScalarCorrectionField = Exclude<CorrectionField, "product_tags">;
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

export type CorrectionBatchFailure = { id: string; code: string };

export type ReviewCorrectionsResult =
  | { failures: CorrectionBatchFailure[] }
  | { error: string };

export type ValidateCorrectionBatchResult =
  | { ok: true; ids: string[] }
  | { ok: false; error: string };

/**
 * Injection seam for `reviewCorrections`. Both members have real defaults, so
 * production callers pass nothing; tests supply fakes because
 * `scripts/check-test-boundaries.mjs` forbids mocking `@/lib/services/` and
 * `@/lib/supabase/` modules outright.
 */
export type ReviewCorrectionsDeps = {
  fetchPendingBrandIds: (
    ids: string[],
  ) => Promise<Array<{ id: string; brand_id: string }>>;
  reviewOne: (
    id: string,
    decision: CorrectionDecision,
    notes: string,
    ctx: { reviewerId: string },
  ) => Promise<ReviewCorrectionResult>;
};

export const MAX_BULK_CORRECTIONS = 100;
const MAX_CORRECTION_ID_LENGTH = 64;
const INVALID_BATCH_ERROR = "Invalid bulk correction selection";

type CorrectionError = Extract<SubmitCorrectionResult, { ok: false }>["code"];
type CurrentBrandValue = number | string | string[] | null;

export function isCorrectionField(value: string): value is CorrectionField {
  return (
    value === "price_range" ||
    value === "product_type" ||
    value === "product_tags" ||
    PURCHASE_COLUMNS.some((field) => field === value) ||
    SOCIAL_LINK_FIELDS.some((field) => field === value)
  );
}

function isPurchaseLinkField(
  field: CorrectionField,
): field is PurchaseLinkCorrectionField {
  return PURCHASE_COLUMNS.some((purchaseField) => purchaseField === field);
}

function isSocialLinkField(
  field: CorrectionField,
): field is SocialLinkCorrectionField {
  return SOCIAL_LINK_FIELDS.some((socialField) => socialField === field);
}

function isLinkField(field: CorrectionField): field is LinkCorrectionField {
  return isPurchaseLinkField(field) || isSocialLinkField(field);
}

function hasHostname(url: URL, hostname: string): boolean {
  return url.hostname === hostname || url.hostname.endsWith(`.${hostname}`);
}

/**
 * Shared guard preamble for every link field: length bound, scheme/host
 * sanitation, private-network rejection, parse, and credential rejection. The
 * caller supplies the raw -> href resolver (plain `sanitizeHref` for purchase
 * links, a handle-aware resolver for social ones) and applies its own host rule
 * to the returned URL. Purchase and social must not drift apart on any of these
 * checks, so they live in exactly one place.
 */
function parseLinkUrl(
  value: unknown,
  resolveHref: (raw: string) => string | null,
): URL | null {
  if (typeof value !== "string" || value.length > MAX_LINK_URL_LENGTH) {
    return null;
  }

  const href = resolveHref(value);
  if (!href || href.length > MAX_LINK_URL_LENGTH || isPrivateUrl(href)) {
    return null;
  }

  try {
    const url = new URL(href);
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function normalizePurchaseUrl(
  field: PurchaseLinkCorrectionField,
  value: unknown,
): string | null {
  const url = parseLinkUrl(value, sanitizeHref);
  if (!url) return null;

  const channel = purchaseChannelByColumn[field];
  const matchesExpectedHost = channel.hosts.some((host) =>
    hasHostname(url, host),
  );
  const matchesOtherChannelHost = PURCHASE_CHANNELS.some(
    (candidate) =>
      candidate !== channel &&
      candidate.hosts.some((host) => hasHostname(url, host)),
  );

  if (
    matchesOtherChannelHost ||
    (channel.hosts.length > 0 && !matchesExpectedHost)
  ) {
    return null;
  }

  return url.href;
}

/**
 * Wraps a handle-expanding resolver so an explicit non-http(s) scheme is
 * rejected BEFORE expansion. `normalizeInstagramHref`/`normalizeThreadsHref`
 * treat any string without an `https?://` prefix as a bare handle and
 * interpolate it into a profile URL — so `javascript:alert(1)` would become a
 * well-formed `https://instagram.com/javascript:alert(1)` and never reach
 * `sanitizeHref`'s own scheme guard, which only fires on the raw value. That is
 * the drift from the purchase path (`parseLinkUrl(value, sanitizeHref)`) that
 * this closes. Contained here on purpose: `@/lib/url`'s helpers are shared with
 * the render path and have a far wider blast radius.
 */
function handleResolver(
  expand: (raw: string) => string | null,
): (raw: string) => string | null {
  return (raw) => {
    const trimmed = raw.trim();
    if (
      !/^https?:\/\//i.test(trimmed) &&
      /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ) {
      return null;
    }
    return expand(trimmed);
  };
}

function normalizeSocialUrl(
  field: SocialLinkCorrectionField,
  value: unknown,
): string | null {
  // Visitors paste bare handles (`@foo`, `foo`) as often as URLs, so the
  // resolver expands those first. Trap: `normalizeInstagramHref` /
  // `normalizeThreadsHref` pass ANY existing http(s) URL through untouched —
  // they convert handle -> URL and do NOT check the host. The `hasHostname`
  // rules below are the only host validation in this path.
  const url = parseLinkUrl(
    value,
    field === "social_instagram"
      ? handleResolver(normalizeInstagramHref)
      : field === "social_threads"
        ? handleResolver(normalizeThreadsHref)
        : sanitizeHref,
  );
  if (!url) return null;

  const isInstagram = hasHostname(url, "instagram.com");
  // Meta migrated Threads from threads.net to threads.com; both resolve to live
  // profiles and both appear in the wild, so accept either. Handle expansion
  // still mints the .net form, which keeps normalization idempotent.
  const isThreads =
    hasHostname(url, "threads.net") || hasHostname(url, "threads.com");
  const isFacebook = hasHostname(url, "facebook.com");

  if (field === "social_instagram") return isInstagram ? url.href : null;
  if (field === "social_threads") return isThreads ? url.href : null;
  return isFacebook ? url.href : null;
}

function normalizeLinkUrl(
  field: LinkCorrectionField,
  value: unknown,
): string | null {
  return isPurchaseLinkField(field)
    ? normalizePurchaseUrl(field, value)
    : normalizeSocialUrl(field, value);
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

  if (isLinkField(field)) {
    const normalizedUrl = normalizeLinkUrl(field, value);
    return normalizedUrl
      ? { ok: true, value: normalizedUrl }
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

export function buildScalarCorrectionPatch(
  field: ScalarCorrectionField,
  proposedValue: number | string,
): BrandWriteInput {
  if (isPurchaseLinkField(field)) {
    const camelField: PurchaseChannelCamelField =
      purchaseChannelByColumn[field].camel;
    const patch: BrandWriteInput = {};
    patch[camelField] = proposedValue as string;
    return patch;
  }

  switch (field) {
    case "price_range":
      return { priceRange: proposedValue as number };
    case "product_type":
      return { productType: proposedValue as string };
    case "social_instagram":
      return { socialInstagram: proposedValue as string };
    case "social_threads":
      return { socialThreads: proposedValue as string };
    case "social_facebook":
      return { socialFacebook: proposedValue as string };
  }
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

function correctionValuesEqual(
  field: CorrectionField,
  currentValue: CurrentBrandValue,
  proposedValue: CorrectionProposedValue,
): boolean {
  // Link fields compare through the same normalizer that produced the stored
  // proposal: a brand column can hold a bare handle or an un-canonicalized URL,
  // which would never string-equal the normalized proposal, so the `unchanged`
  // guard would stop firing and no-op rows would pile up in the queue.
  if (!isLinkField(field)) {
    return valuesEqual(currentValue, proposedValue);
  }

  return normalizeLinkUrl(field, currentValue) === proposedValue;
}

function currentValueForField(
  field: CorrectionField,
  brand: BrandCorrectionBrand | null | undefined,
): CurrentBrandValue {
  if (!brand) return null;
  if (isPurchaseLinkField(field)) {
    // `?? null` because the purchase columns are optional on the row shape:
    // a projection that omits one yields undefined, which CurrentBrandValue
    // does not admit.
    return brand[purchaseChannelByColumn[field].column] ?? null;
  }

  // Exhaustive by design — no fallthrough default, so a field added to
  // `CorrectionField` without a case here cannot silently read another
  // column's value.
  switch (field) {
    case "price_range":
      return brand.price_range;
    case "product_type":
      return brand.product_type;
    case "product_tags":
      return Array.isArray(brand.product_tags) ? brand.product_tags : [];
    case "social_instagram":
      return brand.social_instagram;
    case "social_threads":
      return brand.social_threads;
    case "social_facebook":
      return brand.social_facebook;
  }
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
  data: BrandCorrectionBrand | null;
  error: { code?: string } | null;
}> {
  // Scoped to approved like every other public read path. This runs on the
  // RLS-bypassing service client behind an unauthenticated action, and brand
  // UUIDs are in the public RSC payload — without this filter the distinct
  // result codes let an anonymous caller probe the existence and field values
  // of brands that are not publicly listed.
  const { data, error } = await supabase
    .from("brands")
    .select(
      `id, name, slug, price_range, product_type, product_tags, ${PURCHASE_COLUMNS.join(
        ", ",
      )}, social_instagram, social_threads, social_facebook`,
    )
    .eq("id", brandId)
    .eq("status", "approved")
    .maybeSingle();

  return {
    data: data as BrandCorrectionBrand | null,
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
  return auditedCall(
    { provider: "brands", operation: "submitCorrection", kind: "service" },
    async () => {
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
    } else if (
      correctionValuesEqual(input.field, currentValue, proposedValue)
    ) {
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
    },
  );
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
  return auditedCall(
    { provider: "brands", operation: "reviewCorrection", kind: "service" },
    async () => {
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
    } else if (correctionValuesEqual(row.field, currentValue, proposedValue)) {
      patch = null;
    } else {
      patch = buildScalarCorrectionPatch(
        row.field as ScalarCorrectionField,
        proposedValue as number | string,
      );
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
    },
  );
}

/**
 * Pure shape guard for a bulk selection, shared by the server action and
 * `reviewCorrections` so the two cannot disagree about what an acceptable batch
 * is. Deduped, order-preserving — grouping downstream is deterministic.
 */
export function validateCorrectionBatch(
  ids: unknown,
): ValidateCorrectionBatchResult {
  return validateIdBatch(ids, {
    max: MAX_BULK_CORRECTIONS,
    maxIdLength: MAX_CORRECTION_ID_LENGTH,
    errorMessage: INVALID_BATCH_ERROR,
  });
}

export const defaultReviewCorrectionsDeps: ReviewCorrectionsDeps = {
  async fetchPendingBrandIds(ids) {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("brand_field_corrections")
      .select("id, brand_id")
      .in("id", ids)
      .eq("status", "pending");

    if (error) throw error;
    return (data ?? []) as Array<{ id: string; brand_id: string }>;
  },
  reviewOne: (id, decision, notes, ctx) =>
    reviewCorrection(id, decision, notes, ctx),
};

/**
 * Bulk review, delegating every item to the single-item `reviewCorrection` so
 * the two paths can never drift on claim-then-write, supersede, or cache
 * invalidation semantics. Each delegated call carries its own audit span, so a
 * batch of N decisions leaves N audit entries rather than one.
 *
 * Concurrency is deliberately two-level — groups in parallel, items within a
 * group strictly sequential — and must stay that way. `reviewCorrection`'s
 * approval path is a read-modify-write: it reads the brand row, computes a
 * patch, then calls `updateBrand`. Two corrections on the SAME brand running
 * concurrently therefore both read the pre-batch row and the later write
 * silently discards the earlier field change. A `product_type` approval makes
 * it worse: `supersedePendingTags` bulk-rejects that brand's sibling pending
 * `product_tags` rows, which a concurrent item may be mid-claim on. Neither
 * failure raises an error — it surfaces weeks later as a brand field that
 * "reverted on its own". Different brands share no row, so those groups are
 * free to overlap.
 */
export async function reviewCorrections(
  ids: string[],
  decision: CorrectionDecision,
  notes: string,
  { reviewerId }: { reviewerId: string },
  deps: ReviewCorrectionsDeps = defaultReviewCorrectionsDeps,
): Promise<ReviewCorrectionsResult> {
  const validated = validateCorrectionBatch(ids);
  if (!validated.ok) return { error: validated.error };
  if (decision !== "approved" && decision !== "rejected") {
    return { error: "Invalid correction decision" };
  }

  const failuresById = new Map<string, CorrectionBatchFailure>();

  // `brand_field_corrections.id` is a uuid, but the batch guard above only
  // bounds length. A single malformed id in a 100-item selection would fail the
  // `.in('id', ids)` uuid cast (Postgres 22P02) and strand every other item, so
  // it is demoted to a per-item failure here instead of aborting the batch.
  const lookupIds = validated.ids.filter((id) => {
    if (isUuid(id)) return true;
    failuresById.set(id, { id, code: "invalid_id" });
    return false;
  });

  let rows: Array<{ id: string; brand_id: string }>;
  try {
    rows = lookupIds.length > 0 ? await deps.fetchPendingBrandIds(lookupIds) : [];
  } catch {
    // Every selected id is owed an individual outcome, so a failed lookup is
    // reported per item rather than collapsed into one batch-level error —
    // the same contract the per-item loop below keeps.
    for (const id of lookupIds) {
      failuresById.set(id, { id, code: "database_error" });
    }
    return { failures: [...failuresById.values()] };
  }

  const brandById = new Map(rows.map((row) => [row.id, row.brand_id]));
  const groups = new Map<string, string[]>();

  for (const id of lookupIds) {
    const brandId = brandById.get(id);
    // An id that no longer resolves to a pending row is reported, never
    // dropped: the reviewer selected it and is owed an outcome for it.
    if (!brandId) {
      failuresById.set(id, { id, code: "not_found" });
      continue;
    }
    const group = groups.get(brandId);
    if (group) group.push(id);
    else groups.set(brandId, [id]);
  }

  const groupFailures = await Promise.all(
    [...groups.values()].map(async (group) => {
      const failures: CorrectionBatchFailure[] = [];
      for (const id of group) {
        try {
          const result = await deps.reviewOne(id, decision, notes, {
            reviewerId,
          });
          if (!result.ok) {
            // Codes pass through unmapped: bulk and single-item review must
            // report a conflict by the same name the other four domains use.
            failures.push({ id, code: result.code });
          }
        } catch {
          // One bad item must not strand the rest of its brand's queue.
          failures.push({ id, code: "database_error" });
        }
      }
      return failures;
    }),
  );

  for (const failure of groupFailures.flat()) {
    failuresById.set(failure.id, failure);
  }

  return {
    failures: validated.ids.flatMap((id) => {
      const failure = failuresById.get(id);
      return failure ? [failure] : [];
    }),
  };
}
