export type BrandWriteActor = {
  source: "enriched" | "owner" | "admin";
  userId?: string;
  jobId?: string;
};

export type BrandFieldWriteState = {
  source: string;
  updatedAt?: string;
};

export type BrandFieldStateRow = {
  field: string;
  source: string;
  updated_at?: string | null;
};

const FIELD_STATE_SOURCE_PRIORITY: Record<string, number> = {
  enriched: 1,
  submitted: 2,
  admin: 3,
  owner: 4,
};

function fieldStateSourcePriority(source: string): number {
  return FIELD_STATE_SOURCE_PRIORITY[source] ?? 0;
}

function shouldReplaceFieldState(
  candidate: BrandFieldStateRow,
  current: BrandFieldStateRow,
): boolean {
  const candidatePriority = fieldStateSourcePriority(candidate.source);
  const currentPriority = fieldStateSourcePriority(current.source);
  if (candidatePriority !== currentPriority) {
    return candidatePriority > currentPriority;
  }

  const candidateUpdatedAt = candidate.updated_at ?? "";
  const currentUpdatedAt = current.updated_at ?? "";
  if (candidateUpdatedAt !== currentUpdatedAt) {
    return candidateUpdatedAt > currentUpdatedAt;
  }

  return candidate.field < current.field;
}

/**
 * Normalizes final persisted field state rows for owner protection. The two
 * subcategory languages are one protected value: an owner lock on either
 * language protects both, regardless of query row order.
 */
export function mergeBrandFieldStates(
  rows: readonly BrandFieldStateRow[],
): Record<string, BrandFieldWriteState> {
  const merged = new Map<string, BrandFieldStateRow>();

  for (const row of rows) {
    const current = merged.get(row.field);
    if (!current || shouldReplaceFieldState(row, current)) {
      merged.set(row.field, row);
    }
  }

  const ownerPair = rows
    .filter(
      (row) =>
        row.source === "owner" &&
        (row.field === "subcategories" || row.field === "subcategories_en"),
    )
    .sort((left, right) => {
      const leftUpdatedAt = left.updated_at ?? "";
      const rightUpdatedAt = right.updated_at ?? "";
      if (leftUpdatedAt !== rightUpdatedAt) {
        return rightUpdatedAt.localeCompare(leftUpdatedAt);
      }
      if (left.field === right.field) return 0;
      return left.field === "subcategories" ? -1 : 1;
    })[0];

  if (ownerPair) {
    merged.set("subcategories", ownerPair);
    merged.set("subcategories_en", ownerPair);
  }

  return Object.fromEntries(
    [...merged].map(([field, row]) => [
      field,
      {
        source: row.source,
        ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
      },
    ]),
  );
}

export type SkippedBrandField = {
  field: string;
  reason: string;
};

export type WritablePatchResult = {
  allowed: Record<string, unknown>;
  skipped: SkippedBrandField[];
};

const ENRICHMENT_EXCLUDED_FIELDS = new Set(["mitStory", "mit_story"]);
const OWNER_PROTECTED_FIELDS = new Set([
  "mit_status",
  "mit_declared_scope",
  "mit_declared_at",
  "mit_declared_by",
]);
const REFRESH_ENRICHMENT_EXCLUDED_FIELDS = new Set([
  "id",
  "name",
  "slug",
  "romanized_name",
  "status",
  "source",
  "contact_email",
  "mit_story",
  "mit_status",
  "mit_verified_at",
  "approved_at",
  "submitted_at",
  "created_at",
  "updated_at",
  "is_demo",
]);

/**
 * Sentinel key on an enrichment patch: fields the enrichment ran on and
 * affirmatively determined should be EMPTY. It is not a brand column, so it is
 * routed around the per-field loop and filtered on its entries instead.
 */
export const CLEARED_FIELDS_KEY = "_cleared_fields";

/**
 * `null` when a refresh may write this field, otherwise the skip reason.
 *
 * Only `owner` blocks. `admin` and `submitted` are descriptive labels: `admin`
 * was applied to 4,150 rows by a provenance backfill whose `else` branch caught
 * every brand without a submission, and `submitted` marks fields enrichment
 * failed to fill on an anonymous submission that passed a publish check, not a
 * per-field fact check. A field with no state row is likewise writable — unknown
 * provenance is not a reason to preserve a value. Overwrites stay recoverable
 * through `brand_field_events`.
 */
function refreshWriteBlockReason(
  field: string,
  fieldState: Record<string, BrandFieldWriteState>,
): string | null {
  const state = fieldState[field];
  if (REFRESH_ENRICHMENT_EXCLUDED_FIELDS.has(field)) return "excluded:identity";
  if (state?.source === "owner") return "protected:owner";
  return null;
}

export function resolveRefreshEnrichmentPatch(
  patch: Record<string, unknown>,
  fieldState: Record<string, BrandFieldWriteState>,
): WritablePatchResult {
  const allowed: Record<string, unknown> = {};
  const skipped: SkippedBrandField[] = [];

  for (const [field, value] of Object.entries(patch)) {
    if (field === CLEARED_FIELDS_KEY) continue;
    const reason = refreshWriteBlockReason(field, fieldState);
    if (reason) {
      skipped.push({ field, reason });
      continue;
    }
    allowed[field] = value;
  }

  // Clearing a field is a write. A locked field must be dropped from the
  // cleared list rather than silently emptied, and it goes through the same
  // `skipped` channel so the `[refresh-enrichment:protected-fields]` log covers
  // it. The `cleared:` prefix keeps a dropped clear distinguishable from a
  // dropped value in that log.
  const clearedFields = patch[CLEARED_FIELDS_KEY];
  if (Array.isArray(clearedFields)) {
    const allowedCleared: string[] = [];
    for (const field of clearedFields) {
      if (typeof field !== "string") continue;
      const reason = refreshWriteBlockReason(field, fieldState);
      if (reason) {
        skipped.push({ field, reason: `cleared:${reason}` });
        continue;
      }
      allowedCleared.push(field);
    }
    if (allowedCleared.length > 0) {
      allowed[CLEARED_FIELDS_KEY] = allowedCleared;
    }
  }

  return { allowed, skipped };
}

export function resolveWritablePatch(
  patch: Record<string, unknown>,
  fieldState: Record<string, BrandFieldWriteState>,
  actor: BrandWriteActor,
): WritablePatchResult {
  const allowed: Record<string, unknown> = {};
  const skipped: SkippedBrandField[] = [];

  for (const [field, value] of Object.entries(patch)) {
    const state = fieldState[field];

    if (actor.source === "admin") {
      allowed[field] = value;
      continue;
    }

    if (actor.source === "owner") {
      if (OWNER_PROTECTED_FIELDS.has(field)) {
        skipped.push({ field, reason: "protected:service_managed" });
        continue;
      }

      allowed[field] = value;
      continue;
    }

    if (ENRICHMENT_EXCLUDED_FIELDS.has(field)) {
      skipped.push({ field, reason: "excluded:mit_story" });
      continue;
    }

    // Same policy as the refresh path: only an owner-authored value is
    // preserved. Diverging here would mean a field a refresh may overwrite is
    // still frozen against direct enrichment, for no stated reason.
    if (state?.source === "owner") {
      skipped.push({ field, reason: "protected:owner" });
      continue;
    }

    allowed[field] = value;
  }

  return { allowed, skipped };
}
